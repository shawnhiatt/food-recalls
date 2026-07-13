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
