import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setupConvex } from "./helpers";

// Bookmarks (SPEC.md §12 Saved tab) are public + reactive by design (not in
// §2's sensitive-data list). Single-household pilot: toggle/list resolve
// "the" seeded member rather than taking a caller-supplied memberId.

async function seedHouseholdWithMember(t: ReturnType<typeof setupConvex>) {
  await t.mutation(internal.seed.seedDefaultHousehold, {});
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
    await seedHouseholdWithMember(t);
    const recall = await seedOneRecall(t);

    const added = await t.mutation(api.bookmarks.toggle, {
      alertId: recall!._id,
      alertType: "recall",
    });
    expect(added).toEqual({ bookmarked: true });

    const listed = await t.query(api.bookmarks.list, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]!.sourceId).toBe("R-1");

    const removed = await t.mutation(api.bookmarks.toggle, {
      alertId: recall!._id,
      alertType: "recall",
    });
    expect(removed).toEqual({ bookmarked: false });
    expect(await t.query(api.bookmarks.list, {})).toHaveLength(0);
  });

  test("list is empty with no seeded household", async () => {
    const t = setupConvex();
    expect(await t.query(api.bookmarks.list, {})).toEqual([]);
  });

  test("outbreak bookmarks resolve alongside recall bookmarks (Phase 4)", async () => {
    const t = setupConvex();
    await seedHouseholdWithMember(t);
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

    const added = await t.mutation(api.bookmarks.toggle, { alertId: outbreakId, alertType: "outbreak" });
    expect(added).toEqual({ bookmarked: true });

    const listed = await t.query(api.bookmarks.list, {});
    expect(listed).toHaveLength(1);
    const entry = listed[0]!;
    expect(entry.alertType).toBe("outbreak");
    if (entry.alertType !== "outbreak") throw new Error("expected an outbreak entry");
    expect(entry.pathogen).toBe("E. coli");
  });
});
