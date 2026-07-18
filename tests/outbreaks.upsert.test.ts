import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  normalizeOutbreak,
  parseOutbreakDetailPage,
  parseOutbreakListItems,
} from "../convex/adapters/cdc";
import { setupConvex } from "./helpers";
import listHtml from "./fixtures/cdc/outbreaks-list.html?raw";
import ecoliHtml from "./fixtures/cdc/outbreak-detail-ecoli.html?raw";
import closedHtml from "./fixtures/cdc/outbreak-detail-closed.html?raw";

// Mirrors tests/upsert.test.ts's coverage for convex/outbreaks.ts's
// upsertBatch: content-hash revisioning (§4, §14 hash stability), applied to
// outbreak-shaped records instead of recalls.
//
// upsertBatch now schedules outbreak notification dispatch on fresh active
// inserts and status transitions (§9, TODO #8). Pin the clock and drain any
// scheduled dispatch so these revisioning tests stay about revisioning and no
// scheduled write leaks past teardown — same pattern as tests/upsert.test.ts.
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-11T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

const drain = (t: ReturnType<typeof setupConvex>) =>
  t.finishAllScheduledFunctions(vi.runAllTimers);

function blueberriesOutbreak() {
  const item = parseOutbreakListItems(listHtml).find((i) => i.title.includes("Blueberries"))!;
  const detail = parseOutbreakDetailPage(ecoliHtml);
  return normalizeOutbreak(item, detail);
}

describe("outbreaks.upsertBatch revisioning", () => {
  test("first ingest inserts with an initial timeline entry", async () => {
    const t = setupConvex();
    const record = blueberriesOutbreak();

    const counts = await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });
    expect(counts).toEqual({ inserted: 1, materialUpdates: 0, touched: 0 });

    const doc = await t.query(internal.outbreaks.getBySourceId, { sourceId: record.sourceId });
    expect(doc).not.toBeNull();
    expect(doc!.updateHistory).toHaveLength(1);
    expect(doc!.updateHistory[0]).toMatchObject({ label: "Outbreak", summary: "Initial listing" });
    expect(doc!.status).toBe("active");
    await drain(t);
  });

  test("re-running ingest on unchanged data produces zero new revisions", async () => {
    const t = setupConvex();
    const record = blueberriesOutbreak();
    await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });

    const second = await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });
    expect(second).toEqual({ inserted: 0, materialUpdates: 0, touched: 1 });

    const doc = await t.query(internal.outbreaks.getBySourceId, { sourceId: record.sourceId });
    expect(doc!.updateHistory).toHaveLength(1);
    await drain(t);
  });

  test("material update (status change) appends a labeled timeline entry", async () => {
    const t = setupConvex();
    const record = blueberriesOutbreak();
    await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });

    // Simulate the same investigation closing on a later ingest run: same
    // list item (so the same sourceId/sourceUrl), a re-fetched detail page
    // that now reports "Closed".
    const item = parseOutbreakListItems(listHtml).find((i) => i.title.includes("Blueberries"))!;
    const revised = normalizeOutbreak(item, parseOutbreakDetailPage(closedHtml));

    const counts = await t.mutation(internal.outbreaks.upsertBatch, { records: [revised] });
    expect(counts).toEqual({ inserted: 0, materialUpdates: 1, touched: 0 });

    const doc = await t.query(internal.outbreaks.getBySourceId, { sourceId: record.sourceId });
    expect(doc!.status).toBe("resolved");
    expect(doc!.updateHistory).toHaveLength(2);
    const update = doc!.updateHistory[1]!;
    expect(update.label).toBe("Update 1");
    expect(update.summary).toContain("Investigation status changed from active to resolved");
    await drain(t);
  });

  test("hash change with identical raw snapshot is a silent refresh, not a material update", async () => {
    const t = setupConvex();
    const record = blueberriesOutbreak();
    await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });

    const reEnriched = {
      ...record,
      riskGroups: [...record.riskGroups, "pregnant"],
      contentHash: "post-enrichment-change-hash",
    };
    const counts = await t.mutation(internal.outbreaks.upsertBatch, { records: [reEnriched] });
    expect(counts).toEqual({ inserted: 0, materialUpdates: 0, touched: 1 });

    const doc = await t.query(internal.outbreaks.getBySourceId, { sourceId: record.sourceId });
    expect(doc!.contentHash).toBe("post-enrichment-change-hash");
    expect(doc!.riskGroups).toContain("pregnant");
    expect(doc!.updateHistory).toHaveLength(1); // no fabricated revision
    await drain(t);
  });

  test("hasAny reports false before any outbreak exists, true after", async () => {
    const t = setupConvex();
    expect(await t.query(internal.outbreaks.hasAny, {})).toBe(false);
    await t.mutation(internal.outbreaks.upsertBatch, { records: [blueberriesOutbreak()] });
    expect(await t.query(internal.outbreaks.hasAny, {})).toBe(true);
    await drain(t);
  });
});

describe("outbreaks public list/get", () => {
  test("list surfaces an active outbreak; get fetches it by id", async () => {
    const t = setupConvex();
    const record = blueberriesOutbreak();
    await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });

    const list = await t.query(api.outbreaks.list, {});
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe(record.title);

    const doc = await t.query(api.outbreaks.get, { id: list[0]!._id });
    expect(doc!.pathogen).toBe("E. coli");
    await drain(t);
  });

  test("a resolved outbreak past the archive window drops out of list", async () => {
    const t = setupConvex();
    const record = { ...blueberriesOutbreak(), status: "resolved" as const, publishedAt: "2020-01-01" };
    await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });

    const list = await t.query(api.outbreaks.list, {});
    expect(list).toHaveLength(0);
    await drain(t);
  });
});

describe("outbreaks.search (§10)", () => {
  test("finds an outbreak by title word, including archived ones the list hides", async () => {
    const t = setupConvex();
    // Resolved + old → excluded from outbreaks.list, but search must still reach it.
    const record = { ...blueberriesOutbreak(), status: "resolved" as const, publishedAt: "2020-01-01" };
    await t.mutation(internal.outbreaks.upsertBatch, { records: [record] });

    expect(await t.query(api.outbreaks.list, {})).toHaveLength(0);

    const hits = await t.query(api.outbreaks.search, { query: "blueberries" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe(record.title);
    await drain(t);
  });

  test("a blank query returns no results", async () => {
    const t = setupConvex();
    await t.mutation(internal.outbreaks.upsertBatch, { records: [blueberriesOutbreak()] });
    expect(await t.query(api.outbreaks.search, { query: "  " })).toEqual([]);
    await drain(t);
  });
});
