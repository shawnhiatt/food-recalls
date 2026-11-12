import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { firmsLikelySame } from "./adapters/fdaRss";

// FDA press-release enrichment (SPEC.md §3/§4 — Phase 1 item). Press items
// never create recall records; they ENRICH matching enforcement records with
// what the API lacks: a real product photo, "who's at risk" risk groups, and
// the human-readable official notice URL (replacing the synthetic
// api.fda.gov link the openFDA adapter falls back to).
//
// Enrichment is deliberately NOT a revision: imageUrl/riskGroups/sourceUrl
// are not content-hash material fields (§4/§6), so applying press data never
// appends a timeline entry and never schedules notification dispatch — the
// feed picks the changes up reactively. Press releases precede enforcement
// records by days-to-weeks, so unmatched items are retried on later ingest
// runs (relinkUnmatched, least recently tried first) until the API record
// lands or the item ages out.

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far apart a press date and a recall's recallDate may be and still link. */
const MATCH_WINDOW_DAYS = 120;
/** Stop retrying unmatched press items after this long. */
const RELINK_WINDOW_DAYS = 180;
/** Most press items one relink run tries (least recently tried first). */
const RELINK_BATCH = 25;
/**
 * Most recall docs one mutation reads while matching. Recall docs carry
 * multi-KB `raw` blobs: ~2.7 KB on average, ~4.9 KB at p99 (2026-11 health
 * audit), so 2,500 docs is ~7 MB typical and ~12 MB worst case, under
 * Convex's 16 MiB per-function read limit. One ±120-day window held ~1,700
 * recalls in the densest stretch seen so far (Apr–May 2026), so a single
 * window always fits; a relink batch stops early when the budget runs out.
 */
const SCAN_BUDGET = 2500;

function isoDaysFrom(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

type MatchWindow = { start: string; end: string };

/** The inclusive recallDate range a press item may link within. */
function matchWindow(publishedAt: string): MatchWindow {
  return {
    start: isoDaysFrom(publishedAt, -MATCH_WINDOW_DAYS),
    end: isoDaysFrom(publishedAt, MATCH_WINDOW_DAYS),
  };
}

/**
 * Recalls with recallDate in (after, end] — or [start, end] when `after` is
 * null — ascending, reading at most `limit + 1` docs. `truncated` means the
 * range held more than `limit`; `docs` is then cut to `limit`.
 */
async function scanRecalls(
  ctx: MutationCtx,
  range: { start: string; after: string | null; end: string },
  limit: number,
): Promise<{ docs: Doc<"recalls">[]; truncated: boolean }> {
  const { start, after, end } = range;
  const docs = await ctx.db
    .query("recalls")
    .withIndex("by_recall_date", (q) =>
      after === null
        ? q.gte("recallDate", start).lte("recallDate", end)
        : q.gt("recallDate", after).lte("recallDate", end),
    )
    .take(limit + 1);
  const truncated = docs.length > limit;
  return { docs: truncated ? docs.slice(0, limit) : docs, truncated };
}

/** Is this recall a plausible enforcement twin of the press item? */
function isTwin(recall: Doc<"recalls">, companyName: string, window: MatchWindow): boolean {
  return (
    // FSIS publishes its own press pages with real photos via its API; FDA
    // press releases only ever describe FDA-regulated recalls.
    recall.source === "fda" &&
    recall.recallDate >= window.start &&
    recall.recallDate <= window.end &&
    firmsLikelySame(companyName, recall.firm)
  );
}

/** Guids from the feed that have no pressItems row yet (i.e. pages to fetch). */
export const filterNewGuids = internalQuery({
  args: { guids: v.array(v.string()) },
  handler: async (ctx, args): Promise<string[]> => {
    const fresh: string[] = [];
    for (const guid of args.guids) {
      const existing = await ctx.db
        .query("pressItems")
        .withIndex("by_guid", (q) => q.eq("guid", guid))
        .unique();
      if (!existing) fresh.push(guid);
    }
    return fresh;
  },
});

/** Anomaly input for sourceHealth (§10): has this feed ever produced items? */
export const hasAny = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    return (await ctx.db.query("pressItems").first()) !== null;
  },
});

type PressFields = {
  url: string;
  companyName: string;
  imageUrl?: string;
  riskGroups: string[];
};

/**
 * Enforcement records within the date window whose firm plausibly matches the
 * press company. A single press release can map to several enforcement
 * records (one per product/lot), so this returns all of them.
 */
async function matchingRecalls(
  ctx: MutationCtx,
  companyName: string,
  publishedAt: string,
): Promise<Doc<"recalls">[]> {
  if (!companyName || !publishedAt) return [];
  const window = matchWindow(publishedAt);
  const { docs, truncated } = await scanRecalls(
    ctx,
    { start: window.start, after: null, end: window.end },
    SCAN_BUDGET,
  );
  if (truncated) {
    console.warn(
      `[press] match window ${window.start}..${window.end} holds more than ${SCAN_BUDGET} recalls; matched within the first ${SCAN_BUDGET}`,
    );
  }
  return docs.filter((recall) => isTwin(recall, companyName, window));
}

/**
 * Patch one recall with press enrichment. No timeline entry, no dispatch.
 * Returns the recall as patched, so a caller holding docs in memory stays
 * current when a second press item matches the same recall.
 */
async function applyToRecall(
  ctx: MutationCtx,
  recall: Doc<"recalls">,
  press: PressFields,
  now: number,
): Promise<Doc<"recalls">> {
  const patch: Record<string, unknown> = { updatedAt: now };
  if (press.imageUrl && recall.imageSource !== "press") {
    patch.imageUrl = press.imageUrl;
    patch.imageSource = "press";
  }
  const mergedRiskGroups = [...new Set([...recall.riskGroups, ...press.riskGroups])];
  if (mergedRiskGroups.length !== recall.riskGroups.length) {
    patch.riskGroups = mergedRiskGroups;
  }
  // The openFDA adapter's sourceUrl is a synthetic API query (§3 wants a real
  // official notice); the press page is the notice.
  if (recall.sourceUrl.includes("api.fda.gov")) {
    patch.sourceUrl = press.url;
  }
  await ctx.db.patch(recall._id, patch);
  return { ...recall, ...patch };
}

/**
 * Record one fetched press item and enrich any matching recalls. Idempotent
 * on guid: re-recording an already-seen item only refreshes the match.
 */
export const recordPressItem = internalMutation({
  args: {
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    publishedAt: v.string(),
    companyName: v.string(),
    productType: v.string(),
    relevant: v.boolean(), // food/animal item — non-food items are recorded but never matched
    imageUrl: v.optional(v.string()),
    riskGroups: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ matched: number }> => {
    const now = Date.now();
    const matches = args.relevant
      ? await matchingRecalls(ctx, args.companyName, args.publishedAt)
      : [];
    for (const recall of matches) {
      await applyToRecall(ctx, recall, args, now);
    }

    const row = {
      guid: args.guid,
      url: args.url,
      title: args.title,
      publishedAt: args.publishedAt,
      companyName: args.companyName,
      productType: args.productType,
      relevant: args.relevant,
      imageUrl: args.imageUrl,
      riskGroups: args.riskGroups,
      matchedRecallIds: matches.map((m) => m._id),
      fetchedAt: now,
      lastMatchAttemptAt: now,
    };
    const existing = await ctx.db
      .query("pressItems")
      .withIndex("by_guid", (q) => q.eq("guid", args.guid))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("pressItems", row);

    return { matched: matches.length };
  },
});

/**
 * Retry matching for still-unmatched press items — enforcement records lag
 * press releases by days-to-weeks, so most links form on a later run, when
 * the openFDA record finally exists.
 *
 * Fair queueing: each run tries the RELINK_BATCH pending items tried least
 * recently (`lastMatchAttemptAt`), so items that never match (drugs that slip
 * the food filter, notices with no enforcement twin) can't hold the front of
 * the queue for their whole 180-day life while newer items wait.
 *
 * Bounded reads: each item matches only within its own ±MATCH_WINDOW_DAYS
 * range. The batch is swept in publishedAt order, starting at the least
 * recently tried item and wrapping around to the older ones, so the windows
 * advance monotonically and each recall in their union is read once (twice at
 * most across the wrap). The sweep stops when SCAN_BUDGET recall docs have
 * been read (Convex's 16 MiB read limit — recall docs carry multi-KB `raw`
 * blobs). Starting at the queue head guarantees it is tried; items left over
 * keep their old `lastMatchAttemptAt`, so they lead the next run.
 */
export const relinkUnmatched = internalMutation({
  // scanBudget: tests only — exercises the early stop without 2,500 fixtures.
  args: { now: v.optional(v.number()), scanBudget: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ relinked: number; attempted: number }> => {
    const now = args.now ?? Date.now();
    const cutoff = new Date(now - RELINK_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
    const all = await ctx.db.query("pressItems").collect();
    const batch = all
      .filter(
        (item) =>
          item.relevant &&
          item.companyName.length > 0 &&
          item.matchedRecallIds.length === 0 &&
          item.publishedAt >= cutoff,
      )
      // Least recently tried first; among equals, newest press date first
      // (likeliest to have just gained its enforcement record).
      .sort(
        (a, b) =>
          a.lastMatchAttemptAt - b.lastMatchAttemptAt ||
          b.publishedAt.localeCompare(a.publishedAt),
      )
      .slice(0, RELINK_BATCH);
    if (batch.length === 0) return { relinked: 0, attempted: 0 };

    const head = batch[0]!.publishedAt;
    const byDate = [...batch].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const sweep = [
      ...byDate.filter((item) => item.publishedAt >= head),
      ...byDate.filter((item) => item.publishedAt < head),
    ];

    let budget = args.scanBudget ?? SCAN_BUDGET;
    let prevStart: string | null = null;
    let scannedThrough: string | null = null; // end of the last range read
    let window: Doc<"recalls">[] = []; // fda recalls read so far, ascending
    let attempted = 0;
    let relinked = 0;
    for (const item of sweep) {
      const range = matchWindow(item.publishedAt);
      if (prevStart !== null && range.start < prevStart) {
        // Wrapped around to the older items: start a fresh sweep.
        scannedThrough = null;
        window = [];
      }
      prevStart = range.start;
      if (scannedThrough === null || range.end > scannedThrough) {
        // Overlaps the last range read: only read past its end.
        const after =
          scannedThrough !== null && scannedThrough >= range.start ? scannedThrough : null;
        const { docs, truncated } = await scanRecalls(
          ctx,
          { start: range.start, after, end: range.end },
          budget,
        );
        if (truncated && attempted > 0) break; // the rest lead the next run
        if (truncated) {
          // A single window denser than the whole budget: match within what
          // fit rather than never trying this item. Not seen in real data.
          console.warn(
            `[press] relink window ${range.start}..${range.end} holds more than ${budget} recalls; matched within the first ${budget}`,
          );
        }
        budget -= docs.length;
        window = window
          .filter((recall) => recall.recallDate >= range.start)
          .concat(docs.filter((recall) => recall.source === "fda"));
        scannedThrough = range.end;
      }

      const matches = window.filter((recall) => isTwin(recall, item.companyName, range));
      for (const recall of matches) {
        const patched = await applyToRecall(ctx, recall, item, now);
        window[window.indexOf(recall)] = patched;
      }
      await ctx.db.patch(item._id, {
        matchedRecallIds: matches.map((m) => m._id),
        lastMatchAttemptAt: now,
      });
      attempted++;
      if (matches.length > 0) relinked++;
    }
    return { relinked, attempted };
  },
});
