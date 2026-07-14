import { internalMutation, internalQuery, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { normalizedRecallFields, hazardTypeValidator } from "./schema";
import type { NormalizedRecall } from "./adapters/types";
import { isFreshForNotification } from "./lib/matching";
import { buildRecallSearchText } from "./lib/search";

// Upsert on (source, sourceId) with content-hash revisioning (SPEC.md §4):
//   hash unchanged  → touch updatedAt only (no timeline entry, per §9 matrix)
//   hash changed    → append updateHistory entry; Phase 2 re-runs matching here
//   new record      → insert with the initial "Recall" timeline entry
// All functions are internal: Phase 0 has no UI and the pilot exposes nothing
// publicly (§2).

const CLOSED_LIFECYCLES = new Set([
  "completed",
  "terminated",
  "withdrawn",
  "corrected",
]);

/** Human summary of what changed between revisions — powers the Timeline view. */
export function diffSummary(prev: NormalizedRecall, next: NormalizedRecall): string {
  const changes: string[] = [];

  const prevStates = new Set(prev.states);
  const nextStates = new Set(next.states);
  const addedStates = next.states.filter((s) => !prevStates.has(s));
  const removedStates = prev.states.filter((s) => !nextStates.has(s));
  if (addedStates.length > 0) changes.push(`states added: ${addedStates.join(", ")}`);
  if (removedStates.length > 0) changes.push(`states removed: ${removedStates.join(", ")}`);

  if (prev.classification !== next.classification) {
    changes.push(
      `classification changed from ${prev.classification || "unset"} to ${next.classification || "unset"}`,
    );
  }
  if (prev.lifecycle !== next.lifecycle) {
    changes.push(`status changed from ${prev.lifecycle} to ${next.lifecycle}`);
  } else if (prev.rawStatus !== next.rawStatus) {
    changes.push(`source status changed to "${next.rawStatus}"`);
  }

  const prevAllergens = new Set(prev.allergens);
  const addedAllergens = next.allergens.filter((a) => !prevAllergens.has(a));
  if (addedAllergens.length > 0) {
    changes.push(`allergens added: ${addedAllergens.join(", ")}`);
  }

  if (prev.productDesc !== next.productDesc) changes.push("product description updated");
  if (prev.productCodes.join("|") !== next.productCodes.join("|")) {
    changes.push("product codes updated");
  }

  if (changes.length === 0) return "record updated";
  const summary = changes.join("; ");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

export type UpsertCounts = {
  inserted: number;
  materialUpdates: number;
  touched: number;
};

/**
 * Structural equality for `raw` source records. Hash changed + raw identical
 * means OUR code changed (enrichment regexes, hash inputs), not the source —
 * see the silent-refresh branch in upsertBatch. Convex may not preserve object
 * key order across storage round-trips, so compare structurally, not by
 * JSON.stringify.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, i) => deepEqual(value, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

export const upsertBatch = internalMutation({
  args: {
    records: v.array(v.object(normalizedRecallFields)),
  },
  handler: async (ctx, args): Promise<UpsertCounts> => {
    const now = Date.now();
    const counts: UpsertCounts = { inserted: 0, materialUpdates: 0, touched: 0 };

    for (const record of args.records) {
      const existing = await ctx.db
        .query("recalls")
        .withIndex("by_source_id", (q) =>
          q.eq("source", record.source).eq("sourceId", record.sourceId),
        )
        .unique();

      if (existing === null) {
        const id = await ctx.db.insert("recalls", {
          ...record,
          searchText: buildRecallSearchText(record),
          updateHistory: [
            {
              date: record.recallDate,
              label: "Recall",
              summary: "Initial notice",
              contentHash: record.contentHash,
            },
          ],
          firstSeenAt: now,
          updatedAt: now,
        });
        counts.inserted++;
        // Notify only on recently-published recalls (§9). The recency guard
        // also keeps the historical backfill from scheduling ~29k dispatches.
        if (isFreshForNotification(record.recallDate, now)) {
          await ctx.scheduler.runAfter(0, internal.notifications.dispatchForRecall, {
            recallId: id,
            event: "new",
          });
        }
        continue;
      }

      if (existing.contentHash === record.contentHash) {
        await ctx.db.patch(existing._id, { updatedAt: now });
        counts.touched++;
        continue;
      }

      // Press enrichment (convex/press.ts) must survive API re-ingest:
      // imageUrl/imageSource survive because adapters omit those keys, but
      // riskGroups and sourceUrl are always emitted and would clobber the
      // press-derived values. riskGroups unions (over-alerting bias, §4);
      // a synthetic api.fda.gov link never replaces a real notice URL (§3).
      const preserved = {
        riskGroups: [...new Set([...existing.riskGroups, ...record.riskGroups])],
        sourceUrl:
          record.sourceUrl.includes("api.fda.gov") &&
          !existing.sourceUrl.includes("api.fda.gov")
            ? existing.sourceUrl
            : record.sourceUrl,
      };

      // Hash changed but the raw source record is identical: OUR code changed
      // (enrichment regexes, hash inputs), not the source. Refresh the stored
      // tags and hash silently — no timeline entry, no dispatch. Without this,
      // re-running ingest after an enrichment improvement would fabricate
      // "material updates" across history (§14 hash stability) and schedule
      // notification dispatch for thousands of old records.
      if (deepEqual(existing.raw, record.raw)) {
        await ctx.db.patch(existing._id, {
          ...record,
          ...preserved,
          searchText: buildRecallSearchText(record),
          updatedAt: now,
        });
        counts.touched++;
        continue;
      }

      // Material update: new revision (§9 "Material update" rows). A transition
      // INTO a closed lifecycle is a closure event (digest closure line for
      // previously-notified members only); anything else re-evaluates as new.
      const entry = {
        date: new Date(now).toISOString().slice(0, 10),
        label: `Update ${existing.updateHistory.length}`,
        summary: diffSummary(toNormalized(existing), record as NormalizedRecall),
        contentHash: record.contentHash,
      };
      await ctx.db.patch(existing._id, {
        ...record,
        ...preserved,
        searchText: buildRecallSearchText(record),
        updateHistory: [...existing.updateHistory, entry],
        updatedAt: now,
      });
      counts.materialUpdates++;
      const becameClosed =
        !CLOSED_LIFECYCLES.has(existing.lifecycle) &&
        CLOSED_LIFECYCLES.has(record.lifecycle);
      if (becameClosed) {
        await ctx.scheduler.runAfter(0, internal.notifications.dispatchForRecall, {
          recallId: existing._id,
          event: "closure",
        });
      } else if (!CLOSED_LIFECYCLES.has(record.lifecycle)) {
        await ctx.scheduler.runAfter(0, internal.notifications.dispatchForRecall, {
          recallId: existing._id,
          event: "material",
        });
      }
      // Still-closed recall edited again → timeline entry only: resolved/
      // withdrawn recalls never notify (§17.12) and non-active records are
      // excluded from matching (§10).
    }

    return counts;
  },
});

function toNormalized(doc: Doc<"recalls">): NormalizedRecall {
  const { _id, _creationTime, updateHistory, firstSeenAt, updatedAt, ...rest } = doc;
  return rest as NormalizedRecall;
}

/**
 * Internal-only existence check for ingest anomaly detection: "has this
 * source ever produced records?" A full count would `.collect()` every
 * document (including the multi-KB `raw` blobs) and blow Convex's 16MB
 * per-query read limit once the backfill lands — this reads exactly one doc.
 */
export const hasAnyFromSource = internalQuery({
  args: { source: v.union(v.literal("fda"), v.literal("fsis")) },
  handler: async (ctx, args): Promise<boolean> => {
    const first = await ctx.db
      .query("recalls")
      .withIndex("by_source_id", (q) => q.eq("source", args.source))
      .first();
    return first !== null;
  },
});

/** Internal-only fetch by source id, for tests and operator debugging. */
export const getBySourceId = internalQuery({
  args: {
    source: v.union(v.literal("fda"), v.literal("fsis")),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("recalls")
      .withIndex("by_source_id", (q) =>
        q.eq("source", args.source).eq("sourceId", args.sourceId),
      )
      .unique();
  },
});

// --- Open Food Facts image fallback (SPEC.md §3 photo strategy, rung 2) ---

const IMAGE_FALLBACK_WINDOW_DAYS = 45;

/**
 * Recent recalls with UPC-like product codes but no image yet — candidates
 * for the Open Food Facts lookup in the fda_rss ingest run. Only the feed's
 * visible head is worth external lookups; older cards keep the placeholder.
 */
export const recentWithoutImage = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const cutoff = new Date(Date.now() - IMAGE_FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const recent = await ctx.db
      .query("recalls")
      .withIndex("by_recall_date", (q) => q.gte("recallDate", cutoff))
      .order("desc")
      .take(200);
    return recent
      .filter((doc) => !doc.imageUrl && doc.productCodes.length > 0)
      .slice(0, args.limit)
      .map((doc) => ({ _id: doc._id, productCodes: doc.productCodes.slice(0, 3) }));
  },
});

/** Set an Open Food Facts image, unless a (better) press image landed first. */
export const applyImageFallback = internalMutation({
  args: { recallId: v.id("recalls"), imageUrl: v.string() },
  handler: async (ctx, args) => {
    const recall = await ctx.db.get(args.recallId);
    if (!recall || recall.imageUrl) return;
    await ctx.db.patch(args.recallId, {
      imageUrl: args.imageUrl,
      imageSource: "openfoodfacts",
      updatedAt: Date.now(),
    });
  },
});

// Public feed (SPEC.md §8/§12): recall data is public government data, so
// `list`/`get` are unauthenticated — unlike household preferences (§2), no
// pilot secret gate applies here.

const ARCHIVE_AFTER_DAYS = 365; // §10: non-active + older than 12 months is archived

/** Cutoff as an ISO date string, since `recallDate` sorts lexicographically. */
function archiveCutoffIso(now: number): string {
  return new Date(now - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    filters: v.optional(
      v.object({
        state: v.optional(v.string()),
        audience: v.optional(v.union(v.literal("human"), v.literal("pet"))),
        hazardType: v.optional(hazardTypeValidator),
        allergen: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const filters = args.filters ?? {};
    const cutoff = archiveCutoffIso(Date.now());

    const page = await ctx.db
      .query("recalls")
      .withIndex("by_recall_date")
      .order("desc")
      .filter((q) => {
        // §10 archive exclusion: active recalls always show; non-active ones
        // drop out of the default feed once older than the cutoff.
        let expr = q.or(q.eq(q.field("lifecycle"), "active"), q.gte(q.field("recallDate"), cutoff));
        if (filters.hazardType) {
          expr = q.and(expr, q.eq(q.field("hazardType"), filters.hazardType));
        }
        if (filters.audience) {
          expr = q.and(expr, q.eq(q.field("audience"), filters.audience));
        }
        return expr;
      })
      .paginate(args.paginationOpts);

    // `state`/`allergen` are array-containment checks the filter builder can't
    // express; applied in JS on the fetched page. Pilot-scale table (hundreds–
    // low thousands of rows) — a page may come back smaller than requested
    // when a filter excludes items, which `usePaginatedQuery` handles fine.
    if (!filters.state && !filters.allergen) return page;
    return {
      ...page,
      page: page.page.filter((doc) => {
        if (filters.state && !doc.states.includes(filters.state) && !doc.states.includes("US")) {
          return false;
        }
        if (filters.allergen && !doc.allergens.includes(filters.allergen)) return false;
        return true;
      }),
    };
  },
});

export const get = query({
  args: { id: v.id("recalls") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
