import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setupConvex, createUser, asUser, linkMemberToUser } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

// Bookmarks (SPEC.md §12 Saved tab) are scoped to the caller's own member row
// (Phase 5 auth). Signed-out reads are empty; toggling requires sign-in.

// Seed the pilot household, then sign in as its owner (claim-by-email links the
// seeded member to a new auth user).
async function seedAndSignIn(t: ReturnType<typeof setupConvex>) {
  await t.mutation(internal.seed.seedDefaultHousehold, {});
  const userId = await createUser(t, "hello@shawnhiatt.com");
  const memberId = await t.run(async (ctx) => (await ctx.db.query("members").first())!._id);
  await linkMemberToUser(t, memberId as Id<"members">, userId);
  return asUser(t, userId);
}

async function seedOneRecall(t: ReturnType<typeof setupConvex>) {
  await t.mutation(internal.recalls.upsertBatch, {
    records: [
      {
        source: "fda",
        sourceId: "R-1",
        title: "Recall 1",
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
        contentHash: "hash-1",
      },
    ],
  });
  return await t.query(internal.recalls.getBySourceId, { source: "fda", sourceId: "R-1" });
}

describe("bookmarks.toggle / list", () => {
  test("toggle adds then removes; list reflects the current state", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    const recall = await seedOneRecall(t);

    const added = await as.mutation(api.bookmarks.toggle, {
      alertId: recall!._id,
      alertType: "recall",
    });
    expect(added).toEqual({ bookmarked: true });

    const listed = await as.query(api.bookmarks.list, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]!.sourceId).toBe("R-1");

    const removed = await as.mutation(api.bookmarks.toggle, {
      alertId: recall!._id,
      alertType: "recall",
    });
    expect(removed).toEqual({ bookmarked: false });
    expect(await as.query(api.bookmarks.list, {})).toHaveLength(0);
  });

  test("list is empty for a signed-out visitor", async () => {
    const t = setupConvex();
    expect(await t.query(api.bookmarks.list, {})).toEqual([]);
  });

  test("toggling while signed out is rejected", async () => {
    const t = setupConvex();
    const recall = await seedOneRecall(t);
    await expect(
      t.mutation(api.bookmarks.toggle, { alertId: recall!._id, alertType: "recall" }),
    ).rejects.toThrow();
  });

  test("outbreak bookmarks resolve alongside recall bookmarks (Phase 4)", async () => {
    const t = setupConvex();
    const as = await seedAndSignIn(t);
    const outbreakId = await t.run((ctx) =>
      ctx.db.insert("outbreaks", {
        source: "cdc",
        sourceId: "ecoli/outbreaks/test-outbreak",
        title: "E. coli Outbreak Linked to Frozen Blueberries",
        pathogen: "E. coli",
        suspectedFood: "Frozen Blueberries",
        states: ["FL", "GA"],
        status: "active",
        caseCount: 12,
        hospitalizations: 4,
        riskGroups: [],
        sourceUrl: "https://www.cdc.gov/ecoli/outbreaks/test-outbreak/index.html",
        raw: {},
        contentHash: "hash-outbreak-1",
        publishedAt: "2026-07-06",
        updateHistory: [],
        firstSeenAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const added = await as.mutation(api.bookmarks.toggle, { alertId: outbreakId, alertType: "outbreak" });
    expect(added).toEqual({ bookmarked: true });

    const listed = await as.query(api.bookmarks.list, {});
    expect(listed).toHaveLength(1);
    const entry = listed[0]!;
    expect(entry.alertType).toBe("outbreak");
    if (entry.alertType !== "outbreak") throw new Error("expected an outbreak entry");
    expect(entry.pathogen).toBe("E. coli");
  });
});
