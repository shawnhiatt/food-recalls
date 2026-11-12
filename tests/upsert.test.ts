import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { normalizeBatch, type NormalizedRecall } from "../convex/adapters/types";
import { normalizeOpenFdaRecord } from "../convex/adapters/openfda";
import { diffSummary } from "../convex/recalls";
import { setupConvex } from "./helpers";
import page from "./fixtures/openfda/enforcement-page.json";

// upsertBatch now schedules Phase-2 notification dispatch on fresh inserts and
// material updates (§9). Pin the clock so the (May-dated) fixtures are never
// "fresh" — keeping these hash-stability tests about revisioning, not
// notifications — and drain any scheduled dispatch so it can't leak a write
// past teardown.
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-11T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

function normalizedFixture(): NormalizedRecall[] {
  const { records, skipped } = normalizeBatch(page.results, normalizeOpenFdaRecord);
  expect(skipped).toHaveLength(0);
  return records;
}

const drain = (t: ReturnType<typeof setupConvex>) =>
  t.finishAllScheduledFunctions(vi.runAllTimers);

describe("upsertBatch revisioning (SPEC.md §4, §14 hash stability)", () => {
  test("first ingest inserts everything with an initial timeline entry", async () => {
    const t = setupConvex();
    const records = normalizedFixture();

    const counts = await t.mutation(internal.recalls.upsertBatch, { records });
    expect(counts).toEqual({ inserted: 5, materialUpdates: 0, touched: 0 });

    const doc = await t.query(internal.recalls.getBySourceId, {
      source: "fda",
      sourceId: "F-1201-2026",
    });
    expect(doc).not.toBeNull();
    expect(doc!.updateHistory).toHaveLength(1);
    expect(doc!.updateHistory[0]).toMatchObject({
      label: "Recall",
      summary: "Initial notice",
      date: "2026-05-28",
    });
  });

  test("re-running ingest on unchanged data produces zero new revisions", async () => {
    const t = setupConvex();
    const records = normalizedFixture();

    await t.mutation(internal.recalls.upsertBatch, { records });
    const secondRun = await t.mutation(internal.recalls.upsertBatch, { records });
    expect(secondRun).toEqual({ inserted: 0, materialUpdates: 0, touched: 5 });

    const doc = await t.query(internal.recalls.getBySourceId, {
      source: "fda",
      sourceId: "F-1201-2026",
    });
    expect(doc!.updateHistory).toHaveLength(1);
  });

  test("material update appends a labeled timeline entry and re-writes fields", async () => {
    const t = setupConvex();
    const records = normalizedFixture();
    await t.mutation(internal.recalls.upsertBatch, { records });

    // openFDA mutates records in place (§15): simulate states added + class raised.
    const mutated = structuredClone(page.results[0]) as Record<string, unknown>;
    mutated["distribution_pattern"] = "NC, SC, GA, VA, and TX";
    mutated["classification"] = "Class I";
    const result = normalizeOpenFdaRecord(mutated);
    if (!result.ok) throw new Error("fixture mutation should normalize");

    const counts = await t.mutation(internal.recalls.upsertBatch, {
      records: [result.record],
    });
    await drain(t); // material update schedules dispatchForRecall
    expect(counts).toEqual({ inserted: 0, materialUpdates: 1, touched: 0 });

    const doc = await t.query(internal.recalls.getBySourceId, {
      source: "fda",
      sourceId: "F-1201-2026",
    });
    expect(doc!.states).toContain("TX");
    expect(doc!.classification).toBe("Class I");
    expect(doc!.updateHistory).toHaveLength(2);
    const update = doc!.updateHistory[1]!;
    expect(update.label).toBe("Update 1");
    expect(update.summary).toContain("States added: TX");
    expect(update.summary).toContain("risk level changed from moderate to high");
    expect(update.contentHash).toBe(result.record.contentHash);

    // Same revision again: only a touch, no third entry (per-revision idempotence).
    const again = await t.mutation(internal.recalls.upsertBatch, {
      records: [result.record],
    });
    expect(again).toEqual({ inserted: 0, materialUpdates: 0, touched: 1 });
  });

  test("hash change with identical raw source = silent tag refresh, not a material update", async () => {
    const t = setupConvex();
    const records = normalizedFixture();
    await t.mutation(internal.recalls.upsertBatch, { records });

    // Simulate an enrichment/hash-scheme code change: the normalized output
    // (and therefore the hash) differs, but the raw source record is
    // byte-identical. This must never fabricate a revision or schedule
    // notification dispatch — only refresh the stored tags and hash.
    const reEnriched = {
      ...records[0]!,
      allergens: [...records[0]!.allergens, "sesame"],
      contentHash: "post-enrichment-change-hash",
    };
    const counts = await t.mutation(internal.recalls.upsertBatch, {
      records: [reEnriched],
    });
    await drain(t); // nothing should be scheduled, but drain defensively
    expect(counts).toEqual({ inserted: 0, materialUpdates: 0, touched: 1 });

    const doc = await t.query(internal.recalls.getBySourceId, {
      source: "fda",
      sourceId: reEnriched.sourceId,
    });
    expect(doc!.contentHash).toBe("post-enrichment-change-hash");
    expect(doc!.allergens).toContain("sesame"); // refreshed tags did land
    expect(doc!.updateHistory).toHaveLength(1); // no fabricated revision
    const sent = await t.run((ctx) => ctx.db.query("notificationsSent").collect());
    expect(sent).toHaveLength(0);
    const queued = await t.run((ctx) => ctx.db.query("digestQueue").collect());
    expect(queued).toHaveLength(0);
  });

  test("still-closed recall edited again gets a timeline entry but schedules no dispatch", async () => {
    const t = setupConvex();
    const records = normalizedFixture();
    await t.mutation(internal.recalls.upsertBatch, { records });

    // Force the stored record into a closed lifecycle first (as if a closure
    // transition had already happened), then apply a further source edit that
    // stays closed. §17.12/§10: timeline only.
    const base = records[0]!;
    await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("recalls")
        .withIndex("by_source_id", (q) =>
          q.eq("source", base.source).eq("sourceId", base.sourceId),
        )
        .unique();
      await ctx.db.patch(doc!._id, { lifecycle: "terminated" });
    });

    const edited = {
      ...base,
      lifecycle: "terminated" as const,
      productDesc: `${base.productDesc} (lot list corrected)`,
      raw: { ...(base.raw as Record<string, unknown>), edited: true },
      contentHash: "closed-edit-hash",
    };
    const counts = await t.mutation(internal.recalls.upsertBatch, {
      records: [edited],
    });
    await drain(t);
    expect(counts).toEqual({ inserted: 0, materialUpdates: 1, touched: 0 });

    const doc = await t.query(internal.recalls.getBySourceId, {
      source: base.source,
      sourceId: base.sourceId,
    });
    expect(doc!.updateHistory).toHaveLength(2); // the edit IS recorded
    const sent = await t.run((ctx) => ctx.db.query("notificationsSent").collect());
    expect(sent).toHaveLength(0); // ...but nothing was dispatched
  });

  test("hasAnyFromSource sees only the requested source", async () => {
    const t = setupConvex();
    await t.mutation(internal.recalls.upsertBatch, { records: normalizedFixture() });
    expect(await t.query(internal.recalls.hasAnyFromSource, { source: "fda" })).toBe(true);
    expect(await t.query(internal.recalls.hasAnyFromSource, { source: "fsis" })).toBe(false);
  });
});

// UX-11: timeline summaries are §11 plain language, and a source-side date
// correction is said out loud rather than silently moving the card's date.
describe("diffSummary wording", () => {
  const base = () => normalizedFixture()[0]!;

  test("risk level changes use §11 words, including Not Yet Classified", () => {
    const prev = { ...base(), classification: "Class II" };
    const next = { ...base(), classification: "Not Yet Classified" };
    expect(diffSummary(prev, next)).toBe("Risk level changed from moderate to not yet rated");
  });

  test("a corrected recall date is named", () => {
    const prev = { ...base(), recallDate: "2016-06-10" };
    const next = { ...base(), recallDate: "2026-06-10" };
    expect(diffSummary(prev, next)).toBe("Recall date changed from 2016-06-10 to 2026-06-10");
  });
});
