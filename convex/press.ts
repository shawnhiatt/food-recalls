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
// records by days-to-weeks, so unmatched items are retried on every ingest
// run (relinkUnmatched) until the API record lands or the window lapses.

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far apart a press date and a recall's recallDate may be and still link. */
const MATCH_WINDOW_DAYS = 120;
/** Stop retrying unmatched press items after this long. */
const RELINK_WINDOW_DAYS = 180;
const RELINK_BATCH = 25;

function isoDaysFrom(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
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
  const windowStart = isoDaysFrom(publishedAt, -MATCH_WINDOW_DAYS);
  const windowEnd = isoDaysFrom(publishedAt, MATCH_WINDOW_DAYS);
  const candidates = await ctx.db
    .query("recalls")
    .withIndex("by_recall_date", (q) =>
      q.gte("recallDate", windowStart).lte("recallDate", windowEnd),
    )
    .take(500);
  return candidates.filter(
    // FSIS publishes its own press pages with real photos via its API; FDA
    // press releases only ever describe FDA-regulated recalls.
    (recall) => recall.source === "fda" && firmsLikelySame(companyName, recall.firm),
  );
}

/** Patch one recall with press enrichment. No timeline entry, no dispatch. */
async function applyToRecall(
  ctx: MutationCtx,
  recall: Doc<"recalls">,
  press: PressFields,
  now: number,
): Promise<void> {
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
 * The candidate window is scanned ONCE for the whole batch, then matched in
 * memory: recall docs carry multi-KB `raw` blobs, so a per-item scan (like
 * recordPressItem's single matchingRecalls call) multiplied across a batch
 * blows Convex's 16MB per-execution read limit — verified live.
 */
export const relinkUnmatched = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ relinked: number }> => {
    const now = args.now ?? Date.now();
    const cutoff = new Date(now - RELINK_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
    const all = await ctx.db.query("pressItems").collect();
    const pending = all
      .filter(
        (item) =>
          item.relevant &&
          item.companyName.length > 0 &&
          item.matchedRecallIds.length === 0 &&
          item.publishedAt >= cutoff,
      )
      .slice(0, RELINK_BATCH);
    if (pending.length === 0) return { relinked: 0 };

    // Every pending item's ±MATCH_WINDOW_DAYS window fits inside
    // [oldest publishedAt − window, ∞): one indexed scan covers the batch.
    const oldest = pending.reduce(
      (min, item) => (item.publishedAt < min ? item.publishedAt : min),
      pending[0]!.publishedAt,
    );
    const candidates = await ctx.db
      .query("recalls")
      .withIndex("by_recall_date", (q) =>
        q.gte("recallDate", isoDaysFrom(oldest, -MATCH_WINDOW_DAYS)),
      )
      .take(600);
    const fdaCandidates = candidates.filter((recall) => recall.source === "fda");

    let relinked = 0;
    for (const item of pending) {
      const windowStart = isoDaysFrom(item.publishedAt, -MATCH_WINDOW_DAYS);
      const windowEnd = isoDaysFrom(item.publishedAt, MATCH_WINDOW_DAYS);
      const matches = fdaCandidates.filter(
        (recall) =>
          recall.recallDate >= windowStart &&
          recall.recallDate <= windowEnd &&
          firmsLikelySame(item.companyName, recall.firm),
      );
      for (const recall of matches) {
        await applyToRecall(ctx, recall, item, now);
      }
      await ctx.db.patch(item._id, {
        matchedRecallIds: matches.map((m) => m._id),
        lastMatchAttemptAt: now,
      });
      if (matches.length > 0) relinked++;
    }
    return { relinked };
  },
});
