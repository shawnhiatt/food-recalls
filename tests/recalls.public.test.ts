import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { NormalizedRecall } from "../convex/adapters/types";
import { setupConvex } from "./helpers";

// Public feed (SPEC.md §8/§12): recall data is unauthenticated. Covers
// archive exclusion (§10: non-active + older than 12 months) and the
// state/allergen array-containment filters the Convex filter builder can't
// express directly (applied in JS on the paginated page).

let counter = 0;
function recall(overrides: Partial<NormalizedRecall> = {}): NormalizedRecall {
  counter += 1;
  return {
    source: "fda",
    sourceId: `R-${counter}`,
    title: `Recall ${counter}`,
    firm: "Test Firm",
    classification: "Class II",
    rawStatus: "Ongoing",
    lifecycle: "active",
    recallDate: "2026-06-01",
    productDesc: "Test product",
    states: ["NC"],
    distribution: "NC",
    productCodes: [],
    allergens: [],
    audience: "human",
    hazardType: "other",
    riskGroups: [],
    sourceUrl: "https://example.test/recall",
    raw: {},
    contentHash: `hash-${counter}`,
    ...overrides,
  };
}

async function seedRecalls(t: ReturnType<typeof setupConvex>, records: NormalizedRecall[]) {
  await t.mutation(internal.recalls.upsertBatch, { records });
}

describe("recalls.list", () => {
  test("excludes non-active recalls older than 12 months, keeps active ones regardless of age", async () => {
    const t = setupConvex();
    await seedRecalls(t, [
      recall({ sourceId: "old-completed", lifecycle: "completed", recallDate: "2020-01-01" }),
      recall({ sourceId: "old-active", lifecycle: "active", recallDate: "2020-01-01" }),
      recall({ sourceId: "recent-completed", lifecycle: "completed", recallDate: "2026-06-01" }),
    ]);

    const page = await t.query(api.recalls.list, { paginationOpts: { numItems: 10, cursor: null } });
    const sourceIds = page.page.map((r) => r.sourceId).sort();
    expect(sourceIds).toEqual(["old-active", "recent-completed"]);
  });

  test("state filter matches the state or nationwide ('US')", async () => {
    const t = setupConvex();
    await seedRecalls(t, [
      recall({ sourceId: "nc-only", states: ["NC"] }),
      recall({ sourceId: "nationwide", states: ["US"] }),
      recall({ sourceId: "tx-only", states: ["TX"] }),
    ]);

    const page = await t.query(api.recalls.list, {
      paginationOpts: { numItems: 10, cursor: null },
      filters: { state: "NC" },
    });
    const sourceIds = page.page.map((r) => r.sourceId).sort();
    expect(sourceIds).toEqual(["nationwide", "nc-only"]);
  });

  test("allergen filter is array-containment", async () => {
    const t = setupConvex();
    await seedRecalls(t, [
      recall({ sourceId: "milk", allergens: ["milk"] }),
      recall({ sourceId: "peanuts", allergens: ["peanuts"] }),
      recall({ sourceId: "none", allergens: [] }),
    ]);

    const page = await t.query(api.recalls.list, {
      paginationOpts: { numItems: 10, cursor: null },
      filters: { allergen: "milk" },
    });
    expect(page.page.map((r) => r.sourceId)).toEqual(["milk"]);
  });

  test("hazardType and audience filters push down to the index query", async () => {
    const t = setupConvex();
    await seedRecalls(t, [
      recall({ sourceId: "microbial-human", hazardType: "microbial", audience: "human" }),
      recall({ sourceId: "microbial-pet", hazardType: "microbial", audience: "pet" }),
      recall({ sourceId: "allergen-human", hazardType: "allergen", audience: "human" }),
    ]);

    const page = await t.query(api.recalls.list, {
      paginationOpts: { numItems: 10, cursor: null },
      filters: { hazardType: "microbial", audience: "human" },
    });
    expect(page.page.map((r) => r.sourceId)).toEqual(["microbial-human"]);
  });

  test("orders reverse-chronological by recallDate", async () => {
    const t = setupConvex();
    await seedRecalls(t, [
      recall({ sourceId: "earliest", recallDate: "2026-01-01" }),
      recall({ sourceId: "latest", recallDate: "2026-06-01" }),
      recall({ sourceId: "middle", recallDate: "2026-03-01" }),
    ]);

    const page = await t.query(api.recalls.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.map((r) => r.sourceId)).toEqual(["latest", "middle", "earliest"]);
  });
});

describe("recalls.search (§10)", () => {
  test("finds by word and by barcode, and reaches ARCHIVED recalls the feed hides", async () => {
    const t = setupConvex();
    await seedRecalls(t, [
      // Non-active + years old → excluded from recalls.list, but search must reach it.
      recall({
        sourceId: "pb",
        title: "Peanut Butter Recall",
        lifecycle: "completed",
        recallDate: "2019-01-01",
        productCodes: ["012345678905"],
      }),
      recall({ sourceId: "salsa", title: "Salsa Recall", firm: "Green Valley Foods" }),
    ]);

    const byWord = await t.query(api.recalls.search, {
      query: "peanut",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(byWord.page.map((r) => r.sourceId)).toEqual(["pb"]);

    const byFirm = await t.query(api.recalls.search, {
      query: "valley",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(byFirm.page.map((r) => r.sourceId)).toEqual(["salsa"]);

    const byUpc = await t.query(api.recalls.search, {
      query: "012345678905",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(byUpc.page.map((r) => r.sourceId)).toEqual(["pb"]);
  });

  test("a blank query returns an empty page instead of erroring the index", async () => {
    const t = setupConvex();
    await seedRecalls(t, [recall({ sourceId: "x" })]);
    const page = await t.query(api.recalls.search, {
      query: "   ",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toEqual([]);
    expect(page.isDone).toBe(true);
  });
});

describe("recalls.get", () => {
  test("returns the full doc including updateHistory, or null when missing", async () => {
    const t = setupConvex();
    await seedRecalls(t, [recall({ sourceId: "detail-test" })]);
    const doc = await t.query(internal.recalls.getBySourceId, { source: "fda", sourceId: "detail-test" });
    expect(doc).not.toBeNull();

    const fetched = await t.query(api.recalls.get, { id: doc!._id });
    expect(fetched?.sourceId).toBe("detail-test");
    expect(fetched?.updateHistory).toHaveLength(1);
  });
});
