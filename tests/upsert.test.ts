import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { normalizeBatch, type NormalizedRecall } from "../convex/adapters/types";
import { normalizeOpenFdaRecord } from "../convex/adapters/openfda";
import { setupConvex } from "./helpers";
import page from "./fixtures/openfda/enforcement-page.json";

function normalizedFixture(): NormalizedRecall[] {
  const { records, skipped } = normalizeBatch(page.results, normalizeOpenFdaRecord);
  expect(skipped).toHaveLength(0);
  return records;
}

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
    expect(update.summary).toContain("classification changed from Class II to Class I");
    expect(update.contentHash).toBe(result.record.contentHash);

    // Same revision again: only a touch, no third entry (per-revision idempotence).
    const again = await t.mutation(internal.recalls.upsertBatch, {
      records: [result.record],
    });
    expect(again).toEqual({ inserted: 0, materialUpdates: 0, touched: 1 });
  });

  test("countBySource counts only the requested source", async () => {
    const t = setupConvex();
    await t.mutation(internal.recalls.upsertBatch, { records: normalizedFixture() });
    expect(
      await t.query(internal.recalls.countBySource, { source: "fda" }),
    ).toBe(5);
    expect(
      await t.query(internal.recalls.countBySource, { source: "fsis" }),
    ).toBe(0);
  });
});
