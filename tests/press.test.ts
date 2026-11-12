import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { NormalizedRecall } from "../convex/adapters/types";
import { setupConvex } from "./helpers";

// Press enrichment (convex/press.ts): press items patch matching enforcement
// records with photo/risk groups/notice URL, and must do so WITHOUT creating
// a revision — no timeline entry, no notification dispatch (§4/§6: image and
// risk-group fields are not content-hash material). Unmatched items relink on
// later runs, since enforcement records lag press releases.

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-11T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

const PRESS = {
  guid: "https://www.fda.gov/press/blueberries",
  url: "https://www.fda.gov/press/blueberries",
  title: "Frutas y Hortalizas del Sur S.A. Initiates Recall of Frozen Blueberries",
  publishedAt: "2026-07-03",
  companyName: "Frutas y Hortalizas del Sur S.A.",
  productType: "Food & Beverages",
  relevant: true,
  imageUrl: "https://www.fda.gov/files/blueberries.png",
  riskGroups: ["child", "older_adult", "immunocompromised"],
};

async function insertRecall(
  t: ReturnType<typeof setupConvex>,
  over: {
    source?: "fda" | "fsis";
    firm?: string;
    recallDate?: string;
    sourceUrl?: string;
    riskGroups?: string[];
  } = {},
): Promise<Id<"recalls">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("recalls", {
      source: over.source ?? "fda",
      sourceId: `S-${Math.random()}`,
      title: "Frozen blueberries",
      firm: over.firm ?? "Frutas y Hortalizas del Sur SA",
      classification: "Class I",
      rawStatus: "Ongoing",
      lifecycle: "active",
      recallDate: over.recallDate ?? "2026-07-01",
      productDesc: "Organic IQF Frozen Blueberries 10 oz",
      states: ["NC"],
      distribution: "NC",
      productCodes: [],
      allergens: [],
      audience: "human",
      hazardType: "microbial",
      riskGroups: over.riskGroups ?? [],
      sourceUrl:
        over.sourceUrl ??
        "https://api.fda.gov/food/enforcement.json?search=recall_number:%22X%22",
      raw: { original: true },
      contentHash: "hash-1",
      updateHistory: [
        { date: "2026-07-01", label: "Recall", summary: "Initial notice", contentHash: "hash-1" },
      ],
      firstSeenAt: now,
      updatedAt: now,
    });
  });
}

describe("recordPressItem (§3 photo strategy + §4 enrichment)", () => {
  test("enriches a firm-matched recall: image, risk groups, notice URL — no revision", async () => {
    const t = setupConvex();
    const recallId = await insertRecall(t);

    const result = await t.mutation(internal.press.recordPressItem, PRESS);
    expect(result.matched).toBe(1);

    const recall = await t.run((ctx) => ctx.db.get(recallId));
    expect(recall!.imageUrl).toBe(PRESS.imageUrl);
    expect(recall!.imageSource).toBe("press");
    expect(recall!.riskGroups).toEqual(
      expect.arrayContaining(["child", "older_adult", "immunocompromised"]),
    );
    expect(recall!.sourceUrl).toBe(PRESS.url); // synthetic api.fda.gov link replaced
    expect(recall!.contentHash).toBe("hash-1"); // not a revision...
    expect(recall!.updateHistory).toHaveLength(1); // ...no timeline entry...
    const sent = await t.run((ctx) => ctx.db.query("notificationsSent").collect());
    const queued = await t.run((ctx) => ctx.db.query("digestQueue").collect());
    expect(sent).toHaveLength(0); // ...and no dispatch
    expect(queued).toHaveLength(0);
  });

  test("a real (non-synthetic) sourceUrl is left alone", async () => {
    const t = setupConvex();
    const recallId = await insertRecall(t, {
      sourceUrl: "https://www.fsis.usda.gov/recalls/some-notice",
    });
    await t.mutation(internal.press.recordPressItem, PRESS);
    // FSIS-source records never match FDA press releases at all:
    const unmatched = await t.run((ctx) => ctx.db.get(recallId));
    expect(unmatched!.sourceUrl).toBe("https://www.fsis.usda.gov/recalls/some-notice");
  });

  test("fsis records and non-food press items never match", async () => {
    const t = setupConvex();
    const fsisId = await insertRecall(t, { source: "fsis" });
    const fdaId = await insertRecall(t);

    // FSIS record with the same firm: not touched.
    const first = await t.mutation(internal.press.recordPressItem, PRESS);
    expect(first.matched).toBe(1); // only the fda record
    expect((await t.run((ctx) => ctx.db.get(fsisId)))!.imageUrl).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(fdaId)))!.imageUrl).toBe(PRESS.imageUrl);

    // Drug-recall press item (relevant: false): recorded but never matched.
    const second = await t.mutation(internal.press.recordPressItem, {
      ...PRESS,
      guid: "https://www.fda.gov/press/some-drug",
      url: "https://www.fda.gov/press/some-drug",
      productType: "Drugs",
      relevant: false,
    });
    expect(second.matched).toBe(0);
  });

  test("date window: a recall far outside the press date never matches", async () => {
    const t = setupConvex();
    await insertRecall(t, { recallDate: "2025-09-01" }); // >120d before publishedAt
    const result = await t.mutation(internal.press.recordPressItem, PRESS);
    expect(result.matched).toBe(0);
  });
});

describe("relinkUnmatched (press precedes the enforcement record)", () => {
  test("an unmatched item links once the API record lands on a later run", async () => {
    const t = setupConvex();

    // Press arrives first: nothing to match yet.
    const first = await t.mutation(internal.press.recordPressItem, PRESS);
    expect(first.matched).toBe(0);

    // Days later the enforcement record is ingested; the next ingest run relinks.
    const recallId = await insertRecall(t);
    const { relinked } = await t.mutation(internal.press.relinkUnmatched, {});
    expect(relinked).toBe(1);

    const recall = await t.run((ctx) => ctx.db.get(recallId));
    expect(recall!.imageUrl).toBe(PRESS.imageUrl);
    expect(recall!.imageSource).toBe("press");

    const items = await t.run((ctx) => ctx.db.query("pressItems").collect());
    expect(items[0]!.matchedRecallIds).toEqual([recallId]);

    // Once matched, later relink runs skip it (no rework).
    const again = await t.mutation(internal.press.relinkUnmatched, {});
    expect(again.relinked).toBe(0);
  });
});

describe("press enrichment survives API re-ingest (upsertBatch preservation)", () => {
  test("a material update keeps the press image, notice URL, and risk groups", async () => {
    const t = setupConvex();
    const recallId = await insertRecall(t, { firm: "Frutas y Hortalizas del Sur S.A." });
    await t.mutation(internal.press.recordPressItem, PRESS);

    // Simulate the next openFDA ingest: same (source, sourceId), changed raw
    // (a real source edit), synthetic sourceUrl, API-derived riskGroups only.
    const existing = await t.run((ctx) => ctx.db.get(recallId));
    const apiRecord: NormalizedRecall = {
      source: "fda",
      sourceId: existing!.sourceId,
      title: existing!.title,
      firm: existing!.firm,
      classification: "Class I",
      rawStatus: "Ongoing",
      lifecycle: "active",
      recallDate: existing!.recallDate,
      productDesc: `${existing!.productDesc} — lot list corrected`,
      states: ["NC", "SC"],
      distribution: "NC, SC",
      productCodes: [],
      allergens: [],
      audience: "human",
      hazardType: "microbial",
      riskGroups: ["pregnant"], // API text only names one group
      sourceUrl: "https://api.fda.gov/food/enforcement.json?search=recall_number:%22X%22",
      raw: { original: true, edited: true },
      contentHash: "hash-2",
    };
    await t.mutation(internal.recalls.upsertBatch, { records: [apiRecord] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const recall = await t.run((ctx) => ctx.db.get(recallId));
    expect(recall!.contentHash).toBe("hash-2");
    expect(recall!.updateHistory).toHaveLength(2); // the real edit IS a revision
    expect(recall!.imageUrl).toBe(PRESS.imageUrl); // press image survives
    expect(recall!.imageSource).toBe("press");
    expect(recall!.sourceUrl).toBe(PRESS.url); // synthetic link doesn't clobber the notice
    expect(recall!.riskGroups).toEqual(
      expect.arrayContaining(["child", "older_adult", "immunocompromised", "pregnant"]),
    );
  });
});

// T6 (2026-11 health audit §5): relink used to take the first 25 pending
// items by creation order and scan recalls ascending from the oldest one's
// window start with take(600); recordPressItem took 500 from its window. So
// never-matching items blocked the queue, and dense months cut off the newest
// candidates.

/** Bulk-insert unrelated FDA recalls on one date (dense-month filler). */
async function insertFiller(
  t: ReturnType<typeof setupConvex>,
  count: number,
  recallDate: string,
): Promise<void> {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("recalls", {
        source: "fda",
        sourceId: `FILLER-${recallDate}-${i}`,
        title: "Assorted baked goods",
        firm: "Unrelated Bakery Company",
        classification: "Class II",
        rawStatus: "Ongoing",
        lifecycle: "active",
        recallDate,
        productDesc: "Assorted baked goods",
        states: ["NC"],
        distribution: "NC",
        productCodes: [],
        allergens: [],
        audience: "human",
        hazardType: "allergen",
        riskGroups: [],
        sourceUrl: "https://api.fda.gov/food/enforcement.json?search=recall_number:%22F%22",
        raw: { filler: true },
        contentHash: "filler",
        updateHistory: [],
        firstSeenAt: now,
        updatedAt: now,
      });
    }
  });
}

/** An unmatched press item for a firm that never gets an enforcement record. */
function orphanPress(i: number, publishedAt: string) {
  return {
    ...PRESS,
    guid: `https://www.fda.gov/press/orphan-${i}`,
    url: `https://www.fda.gov/press/orphan-${i}`,
    title: `Orphan notice ${i}`,
    publishedAt,
    companyName: `Never Enforced Firm ${i}`,
    imageUrl: undefined,
  };
}

async function pressItem(t: ReturnType<typeof setupConvex>, guid: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("pressItems")
      .withIndex("by_guid", (q) => q.eq("guid", guid))
      .unique(),
  );
}

describe("relinkUnmatched fairness and bounded windows (T6)", () => {
  test("items that never match don't block newer ones: the queue rotates", async () => {
    const t = setupConvex();

    // 30 older press items that will never get an enforcement twin, recorded
    // before the one that will — more than one relink batch (25).
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
    for (let i = 0; i < 30; i++) {
      await t.mutation(internal.press.recordPressItem, orphanPress(i, "2026-04-20"));
    }
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));
    await t.mutation(internal.press.recordPressItem, PRESS);
    const recallId = await insertRecall(t); // the twin lands later

    // Run 1: the 25 least recently tried are all orphans.
    vi.setSystemTime(new Date("2026-07-11T12:00:00Z"));
    const run1 = await t.mutation(internal.press.relinkUnmatched, {});
    expect(run1).toEqual({ relinked: 0, attempted: 25 });
    const triedRun1 = (await t.run((ctx) => ctx.db.query("pressItems").collect()))
      .filter((item) => item.lastMatchAttemptAt === Date.now())
      .map((item) => item.guid)
      .sort();
    expect(triedRun1).toHaveLength(25);

    // Run 2: the 5 untried orphans and the newer item lead the batch (the
    // rest of it refills from run 1's), and the newer item now matches.
    // Before T6 this run retried exactly run 1's 25 and never reached it.
    vi.setSystemTime(new Date("2026-07-11T15:00:00Z"));
    const run2 = await t.mutation(internal.press.relinkUnmatched, {});
    expect(run2).toEqual({ relinked: 1, attempted: 25 });
    expect((await t.run((ctx) => ctx.db.get(recallId)))!.imageUrl).toBe(PRESS.imageUrl);
    expect((await pressItem(t, PRESS.guid))!.matchedRecallIds).toEqual([recallId]);

    // After two runs, every pending item has been tried at least once.
    const items = await t.run((ctx) => ctx.db.query("pressItems").collect());
    const run1At = new Date("2026-07-11T12:00:00Z").getTime();
    expect(items.every((item) => item.lastMatchAttemptAt >= run1At)).toBe(true);
    const triedRun2 = items
      .filter((item) => item.lastMatchAttemptAt === Date.now())
      .map((item) => item.guid);
    expect(triedRun2).toEqual(
      expect.arrayContaining(
        items.filter((item) => !triedRun1.includes(item.guid)).map((item) => item.guid),
      ),
    );
  });

  test("an old pending item doesn't pin the scan: a recent pair past a dense stretch matches", async () => {
    const t = setupConvex();

    vi.setSystemTime(new Date("2026-02-02T12:00:00Z"));
    await t.mutation(internal.press.recordPressItem, orphanPress(0, "2026-02-01"));
    // 650 recalls just after the old item's date: more than the old
    // single-scan cap (600) between its window start and the recent pair.
    await insertFiller(t, 650, "2026-02-15");

    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));
    await t.mutation(internal.press.recordPressItem, PRESS);
    const recallId = await insertRecall(t, { recallDate: "2026-07-01" });

    vi.setSystemTime(new Date("2026-07-11T12:00:00Z"));
    const run = await t.mutation(internal.press.relinkUnmatched, {});
    expect(run).toEqual({ relinked: 1, attempted: 2 });
    const recall = await t.run((ctx) => ctx.db.get(recallId));
    expect(recall!.imageSource).toBe("press");
    expect(recall!.sourceUrl).toBe(PRESS.url);
    expect((await pressItem(t, orphanPress(0, "").guid))!.matchedRecallIds).toEqual([]);
  });

  test("a run that exhausts its read budget stops, and the leftover leads the next run", async () => {
    const t = setupConvex();

    // Item A (older press date, tried longest ago) and B (the matchable one)
    // have windows that each hold 8 recalls; a budget of 10 covers only one.
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    await t.mutation(internal.press.recordPressItem, orphanPress(0, "2026-02-01"));
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));
    await t.mutation(internal.press.recordPressItem, PRESS);
    await insertFiller(t, 8, "2026-01-01"); // only in A's window
    await insertFiller(t, 7, "2026-07-02"); // only in B's window
    const recallId = await insertRecall(t, { recallDate: "2026-07-01" });

    vi.setSystemTime(new Date("2026-07-11T12:00:00Z"));
    const run1 = await t.mutation(internal.press.relinkUnmatched, { scanBudget: 10 });
    expect(run1).toEqual({ relinked: 0, attempted: 1 }); // A only
    expect((await pressItem(t, PRESS.guid))!.lastMatchAttemptAt).toBe(
      new Date("2026-07-05T12:00:00Z").getTime(),
    ); // B untouched, so it leads next time

    vi.setSystemTime(new Date("2026-07-11T15:00:00Z"));
    const run2 = await t.mutation(internal.press.relinkUnmatched, { scanBudget: 10 });
    expect(run2).toEqual({ relinked: 1, attempted: 1 }); // B, from the queue head
    expect((await t.run((ctx) => ctx.db.get(recallId)))!.imageUrl).toBe(PRESS.imageUrl);
  });

  test("two press items enriching one recall in the same run keep both risk groups", async () => {
    const t = setupConvex();
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));
    await t.mutation(internal.press.recordPressItem, { ...PRESS, riskGroups: ["child"] });
    await t.mutation(internal.press.recordPressItem, {
      ...PRESS,
      guid: "https://www.fda.gov/press/blueberries-expanded",
      url: "https://www.fda.gov/press/blueberries-expanded",
      publishedAt: "2026-07-06",
      riskGroups: ["pregnant"],
    });
    const recallId = await insertRecall(t);

    vi.setSystemTime(new Date("2026-07-11T12:00:00Z"));
    const run = await t.mutation(internal.press.relinkUnmatched, {});
    expect(run).toEqual({ relinked: 2, attempted: 2 });
    const recall = await t.run((ctx) => ctx.db.get(recallId));
    expect(recall!.riskGroups).toEqual(expect.arrayContaining(["child", "pregnant"]));
  });
});

describe("recordPressItem window (T6)", () => {
  test("a dense month before the press date no longer truncates the newest candidates", async () => {
    const t = setupConvex();
    // 520 recalls early in the ±120-day window: more than the old take(500),
    // all sorting before the real twin dated just after the press release.
    await insertFiller(t, 520, "2026-06-15");
    const recallId = await insertRecall(t, { recallDate: "2026-07-05" });

    const result = await t.mutation(internal.press.recordPressItem, PRESS);
    expect(result.matched).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(recallId)))!.imageSource).toBe("press");
  });
});
