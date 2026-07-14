import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setupConvex, createUser, asUser, linkMemberToUser } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import type { NormalizedRecall } from "../convex/adapters/types";
import type { MatchedFeedEntry } from "../convex/feed";

// §8 feed personalization (convex/feed.ts) — the "For your household"
// pinned section's data source. Matching itself is covered exhaustively in
// matching.test.ts; these tests pin the reactive scoping (signed-out/no
// household → null, never another household's data) and the §8 ranking.
//
// Some seeded recalls here meet the hard floor / Recommended threshold and
// so schedule an instant-email action — fake timers + finishAllScheduledFunctions
// drain those deterministically (same pattern as notifications.test.ts),
// otherwise convex-test runs them after teardown and warns about writes
// outside a transaction.
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-11T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

async function seedAndSignIn(t: ReturnType<typeof setupConvex>) {
  await t.mutation(internal.seed.seedDefaultHousehold, {});
  const userId = await createUser(t, "hello@shawnhiatt.com");
  const memberId = await t.run(async (ctx) => (await ctx.db.query("members").first())!._id);
  await linkMemberToUser(t, memberId as Id<"members">, userId);
  return asUser(t, userId);
}

async function seedRecall(
  t: ReturnType<typeof setupConvex>,
  overrides: Partial<NormalizedRecall> = {},
) {
  const sourceId = `R-${Math.random().toString(36).slice(2)}`;
  await t.mutation(internal.recalls.upsertBatch, {
    records: [
      {
        source: "fda",
        sourceId,
        title: "Recall",
        firm: "Acme Foods",
        classification: "Class II",
        rawStatus: "Ongoing",
        lifecycle: "active",
        recallDate: "2026-07-01",
        productDesc: "Test product",
        states: ["CA"], // deliberately NOT the seeded household's NC, unless overridden
        distribution: "",
        productCodes: [],
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
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return (await t.query(internal.recalls.getBySourceId, { source: "fda", sourceId }))!;
}

/** Narrow a myMatches result down to its recall entries. */
function recallEntries(matches: MatchedFeedEntry[] | null) {
  return (matches ?? []).filter(
    (m): m is Extract<MatchedFeedEntry, { alertType: "recall" }> => m.alertType === "recall",
  );
}

describe("feed.myMatches", () => {
  test("null for a signed-out visitor", async () => {
    const t = setupConvex();
    expect(await t.query(api.feed.myMatches, {})).toBeNull();
  });

  test("matches a recall on the household's state (NC, from the default seed)", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    const recall = await seedRecall(t, { states: ["NC"] });

    const matches = await as.query(api.feed.myMatches, {});
    expect(matches).not.toBeNull();
    const entry = recallEntries(matches).find((m) => m.recall._id === recall._id);
    expect(entry).toBeDefined();
    expect(entry!.matchedOn).toContain("state");
    expect(entry!.confidence).toBe("high");
  });

  test("no entry for a recall that doesn't match the household", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    const recall = await seedRecall(t, { states: ["CA"] }); // household is NC-only

    const matches = await as.query(api.feed.myMatches, {});
    expect(recallEntries(matches).some((m) => m.recall._id === recall._id)).toBe(false);
  });

  test("chain match against distribution text is labeled 'possible' and names the store (§14 Phase 6)", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    await as.mutation(api.household.updatePreferences, { chains: ["Publix"] });
    const recall = await seedRecall(t, {
      states: ["CA"], // no state match — isolate the chain dimension
      distribution: "Distributed to Publix stores nationwide.",
    });

    const matches = await as.query(api.feed.myMatches, {});
    const entry = recallEntries(matches).find((m) => m.recall._id === recall._id)!;
    expect(entry.matchedOn).toEqual(["chain"]);
    expect(entry.confidence).toBe("possible");
    expect(entry.matchedDetails.chain).toEqual(["Publix"]);
  });

  test("risk-group/allergen matches rank above a state-only match (§8)", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    await as.mutation(api.household.updatePreferences, { allergens: ["milk"] });

    const stateOnly = await seedRecall(t, { states: ["NC"], classification: "Class I" });
    const allergenMatch = await seedRecall(t, {
      states: ["CA"],
      allergens: ["milk"],
      classification: "Class III", // deliberately lower severity than stateOnly
    });

    const matches = await as.query(api.feed.myMatches, {});
    const ids = recallEntries(matches).map((m) => m.recall._id);
    expect(ids.indexOf(allergenMatch._id)).toBeLessThan(ids.indexOf(stateOnly._id));
  });

  test("outbreaks are excluded when the household's outbreaks category is off", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    await as.mutation(api.household.updatePreferences, {
      categories: { humanFood: true, petFood: true, outbreaks: false },
    });
    const outbreakId = await t.run((ctx) =>
      ctx.db.insert("outbreaks", {
        source: "cdc",
        sourceId: "test-outbreak",
        title: "Test Outbreak",
        pathogen: "E. coli",
        suspectedFood: "Spinach",
        states: ["NC"],
        status: "active",
        riskGroups: [],
        sourceUrl: "https://cdc.gov/test",
        raw: {},
        contentHash: "hash-outbreak",
        publishedAt: "2026-07-01",
        updateHistory: [],
        firstSeenAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const matches = await as.query(api.feed.myMatches, {});
    expect(
      matches!.some((m) => m.alertType === "outbreak" && m.outbreak._id === outbreakId),
    ).toBe(false);
  });
});

describe("feed.matchForAlert", () => {
  test("returns match info for a matching recall, null for a non-matching one", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    const matchingRecall = await seedRecall(t, { states: ["NC"] });
    const nonMatchingRecall = await seedRecall(t, { states: ["CA"] });

    const hit = await as.query(api.feed.matchForAlert, {
      alertId: matchingRecall._id,
      alertType: "recall",
    });
    expect(hit).not.toBeNull();
    expect(hit!.matchedOn).toContain("state");

    const miss = await as.query(api.feed.matchForAlert, {
      alertId: nonMatchingRecall._id,
      alertType: "recall",
    });
    expect(miss).toBeNull();
  });

  test("null for a signed-out visitor", async () => {
    const t = setupConvex();
    const recall = await seedRecall(t, { states: ["NC"] });
    expect(
      await t.query(api.feed.matchForAlert, { alertId: recall._id, alertType: "recall" }),
    ).toBeNull();
  });
});
