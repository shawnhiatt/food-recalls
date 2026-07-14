import { describe, expect, test } from "vitest";
import { matchByFirm, matchByUpc, matchPantryItem } from "../convex/lib/pantry";
import { api, internal } from "../convex/_generated/api";
import { setupConvex, createUser, asUser, linkMemberToUser } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import type { NormalizedRecall } from "../convex/adapters/types";

// Pantry matching (SPEC.md §7 pantry dimension, §14 Phase 7 exit criteria):
// exact UPC match first (high confidence), same-manufacturer soft match on a
// miss (possible confidence), and — the key exit-criteria fixture — a pantry
// item auto-matches a recall ingested AFTER the item was scanned, with no
// extra wiring, because `pantry.matches` is a live reactive query.

describe("matchPantryItem (pure, §7)", () => {
  const recalls = [
    { _id: "r1", productCodes: ["012345"], firm: "Acme Foods, Inc." },
    { _id: "r2", productCodes: [], firm: "Green Valley Farms" },
  ];

  test("exact UPC match wins at high confidence", () => {
    const r = matchPantryItem({ upc: "012345" }, recalls);
    expect(r).toEqual({ matched: true, confidence: "high", recallIds: ["r1"] });
  });

  test("no UPC match, no brand → not matched", () => {
    const r = matchPantryItem({ upc: "999999" }, recalls);
    expect(r).toEqual({ matched: false });
  });

  test("same-manufacturer soft match on a UPC miss, at possible confidence", () => {
    const r = matchPantryItem({ upc: "999999", brand: "Acme" }, recalls);
    expect(r).toEqual({ matched: true, confidence: "possible", recallIds: ["r1"] });
  });

  test("brand match is bidirectional substring", () => {
    expect(matchByFirm("acme foods", recalls)).toEqual(["r1"]);
    expect(matchByFirm("Acme", recalls)).toEqual(["r1"]);
  });

  test("UPC match takes priority over a brand that would also soft-match", () => {
    const r = matchPantryItem({ upc: "012345", brand: "totally different brand" }, recalls);
    expect(r).toEqual({ matched: true, confidence: "high", recallIds: ["r1"] });
  });

  test("matchByUpc with no recalls never matches", () => {
    expect(matchByUpc("012345", [])).toEqual([]);
  });
});

async function seedAndSignIn(t: ReturnType<typeof setupConvex>) {
  await t.mutation(internal.seed.seedDefaultHousehold, {});
  const userId = await createUser(t, "hello@shawnhiatt.com");
  const memberId = await t.run(async (ctx) => (await ctx.db.query("members").first())!._id);
  await linkMemberToUser(t, memberId as Id<"members">, userId);
  return asUser(t, userId);
}

async function seedActiveRecall(
  t: ReturnType<typeof setupConvex>,
  overrides: Partial<NormalizedRecall> = {},
) {
  const sourceId = `R-${Math.random().toString(36).slice(2)}`;
  await t.mutation(internal.recalls.upsertBatch, {
    records: [
      {
        source: "fda",
        sourceId,
        title: "Test Recall",
        firm: "Acme Foods",
        classification: "Class II",
        rawStatus: "Ongoing",
        lifecycle: "active",
        recallDate: "2025-01-01", // stale — never triggers notification dispatch scheduling
        productDesc: "Test product",
        states: ["US"],
        distribution: "",
        productCodes: ["012345"],
        allergens: [],
        audience: "human",
        hazardType: "other",
        riskGroups: [],
        sourceUrl: "https://example.test/recall",
        raw: {},
        contentHash: `hash-${sourceId}`,
        ...overrides,
      },
    ],
  });
  return (await t.query(internal.recalls.getBySourceId, { source: "fda", sourceId }))!;
}

describe("pantry.recordScan / list", () => {
  test("records a scan (household resolved from the caller's own identity) and lists newest first", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);

    await as.mutation(internal.pantry.recordScan, { upc: "111111", productName: "Widget", brand: "Acme" });
    await as.mutation(internal.pantry.recordScan, { upc: "222222" });

    const listed = await as.query(api.pantry.list, {});
    expect(listed).toHaveLength(2);
    expect(listed[0]!.upc).toBe("222222"); // most recent first
    expect(listed[1]!.productName).toBe("Widget");
  });

  test("recordScan rejects when signed out (no household to resolve)", async () => {
    const t = setupConvex();
    await expect(t.mutation(internal.pantry.recordScan, { upc: "111111" })).rejects.toThrow();
  });

  test("list is empty for a signed-out visitor", async () => {
    const t = setupConvex();
    expect(await t.query(api.pantry.list, {})).toEqual([]);
  });
});

describe("pantry.matches — live auto-matching (§14 Phase 7)", () => {
  test("a pantry item auto-matches a recall ingested AFTER the scan", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);

    // Scan a product BEFORE any recall mentions it.
    await as.mutation(internal.pantry.recordScan, {
      upc: "012345",
      productName: "Test Widget",
      brand: "Acme",
    });
    let matches = await as.query(api.pantry.matches, {});
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matched).toBe(false);

    // Now a recall naming that exact UPC is ingested.
    await seedActiveRecall(t, { productCodes: ["012345"] });

    matches = await as.query(api.pantry.matches, {});
    expect(matches[0]!.matched).toBe(true);
    expect(matches[0]!.confidence).toBe("high");
    expect(matches[0]!.matchedRecalls).toHaveLength(1);
  });

  test("same-manufacturer soft match surfaces at possible confidence", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    await as.mutation(internal.pantry.recordScan, { upc: "999999", brand: "Acme" });
    await seedActiveRecall(t, { firm: "Acme Foods, Inc.", productCodes: ["888888"] });

    const matches = await as.query(api.pantry.matches, {});
    expect(matches[0]!.matched).toBe(true);
    expect(matches[0]!.confidence).toBe("possible");
  });

  test("empty for a signed-out visitor", async () => {
    const t = setupConvex();
    expect(await t.query(api.pantry.matches, {})).toEqual([]);
  });
});

describe("pantry.remove", () => {
  test("removes a household's own item", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    await as.mutation(internal.pantry.recordScan, { upc: "012345" });
    const [item] = await as.query(api.pantry.list, {});

    await as.mutation(api.pantry.remove, { itemId: item!._id });
    expect(await as.query(api.pantry.list, {})).toHaveLength(0);
  });

  test("rejects removing an item that isn't in the caller's household", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    const otherItemId = await t.run(async (ctx) => {
      const otherHouseholdId = await ctx.db.insert("households", { name: "Other household" });
      return await ctx.db.insert("pantryItems", {
        householdId: otherHouseholdId,
        upc: "012345",
        scannedAt: Date.now(),
      });
    });
    await expect(as.mutation(api.pantry.remove, { itemId: otherItemId })).rejects.toThrow();
  });
});
