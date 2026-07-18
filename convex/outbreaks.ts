import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { normalizedOutbreakFields } from "./schema";
import type { NormalizedOutbreak } from "./adapters/cdc";
import { deepEqual, type UpsertCounts } from "./recalls";
import { isFreshForNotification } from "./lib/matching";
import { buildOutbreakSearchText, normalizeSearchQuery } from "./lib/search";

// Upsert on (source, sourceId) with content-hash revisioning (SPEC.md §4,
// Phase 4), mirroring convex/recalls.ts's upsertBatch. All functions here are
// internal except the read-only feed/detail queries at the bottom (outbreak
// data is public government data, same posture as recalls.list/get, §2).
//
// Notification dispatch (TODO #8, 2026-07-18): upsertBatch schedules
// internal.notifications.dispatchForOutbreak on a fresh active insert ('new'),
// a material revision to an active outbreak ('material'), and an active→resolved
// transition ('resolution'). The §9 matcher/router already generalize to
// outbreak-shaped alerts; dispatchForOutbreak adds the outbreak-specific gate
// (categories.outbreaks) and Class I-equivalent severity (§4).

/** Human summary of what changed between revisions — powers the Timeline view. */
function diffSummary(prev: NormalizedOutbreak, next: NormalizedOutbreak): string {
  const changes: string[] = [];

  if (prev.status !== next.status) {
    changes.push(`investigation status changed from ${prev.status} to ${next.status}`);
  }

  const prevStates = new Set(prev.states);
  const addedStates = next.states.filter((s) => !prevStates.has(s));
  if (addedStates.length > 0) changes.push(`states added: ${addedStates.join(", ")}`);

  if (prev.caseCount !== next.caseCount) {
    changes.push(`case count updated to ${next.caseCount ?? "unknown"}`);
  }
  if (prev.hospitalizations !== next.hospitalizations) {
    changes.push(`hospitalizations updated to ${next.hospitalizations ?? "unknown"}`);
  }

  if (changes.length === 0) return "investigation updated";
  const summary = changes.join("; ");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function toNormalized(doc: Doc<"outbreaks">): NormalizedOutbreak {
  const { _id, _creationTime, updateHistory, firstSeenAt, updatedAt, ...rest } = doc;
  return rest as NormalizedOutbreak;
}

export const upsertBatch = internalMutation({
  args: {
    records: v.array(v.object(normalizedOutbreakFields)),
  },
  handler: async (ctx, args): Promise<UpsertCounts> => {
    const now = Date.now();
    const counts: UpsertCounts = { inserted: 0, materialUpdates: 0, touched: 0 };

    for (const record of args.records) {
      const existing = await ctx.db
        .query("outbreaks")
        .withIndex("by_source_id", (q) =>
          q.eq("source", record.source).eq("sourceId", record.sourceId),
        )
        .unique();

      if (existing === null) {
        const id = await ctx.db.insert("outbreaks", {
          ...record,
          searchText: buildOutbreakSearchText(record),
          updateHistory: [
            {
              date: record.publishedAt,
              label: "Outbreak",
              summary: "Initial listing",
              contentHash: record.contentHash,
            },
          ],
          firstSeenAt: now,
          updatedAt: now,
        });
        counts.inserted++;
        // Notify only on recently-published ACTIVE outbreaks (§4/§9). The
        // recency guard keeps a historical backfill from blasting old ones.
        if (record.status === "active" && isFreshForNotification(record.publishedAt, now)) {
          await ctx.scheduler.runAfter(0, internal.notifications.dispatchForOutbreak, {
            outbreakId: id,
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

      // Hash changed but our own raw snapshot is identical: our extraction
      // code changed (e.g. an enrichment regex), not the source page. Refresh
      // silently — no timeline entry — mirroring recalls.upsertBatch's guard.
      if (deepEqual(existing.raw, record.raw)) {
        await ctx.db.patch(existing._id, {
          ...record,
          searchText: buildOutbreakSearchText(record),
          updatedAt: now,
        });
        counts.touched++;
        continue;
      }

      const entry = {
        date: new Date(now).toISOString().slice(0, 10),
        label: `Update ${existing.updateHistory.length}`,
        summary: diffSummary(toNormalized(existing), record as NormalizedOutbreak),
        contentHash: record.contentHash,
      };
      await ctx.db.patch(existing._id, {
        ...record,
        searchText: buildOutbreakSearchText(record),
        updateHistory: [...existing.updateHistory, entry],
        updatedAt: now,
      });
      counts.materialUpdates++;
      // §9 routing: an active→resolved transition is a resolution (digest
      // closure line for previously-notified members); any other update to a
      // still-active outbreak re-evaluates as a material change. A still-
      // resolved outbreak edited again is timeline-only (no dispatch).
      const becameResolved =
        existing.status === "active" && record.status === "resolved";
      if (becameResolved) {
        await ctx.scheduler.runAfter(0, internal.notifications.dispatchForOutbreak, {
          outbreakId: existing._id,
          event: "resolution",
        });
      } else if (record.status === "active") {
        await ctx.scheduler.runAfter(0, internal.notifications.dispatchForOutbreak, {
          outbreakId: existing._id,
          event: "material",
        });
      }
    }

    return counts;
  },
});

/** Anomaly-detection input for sourceHealth (§10): has this source ever produced records? */
export const hasAny = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    return (await ctx.db.query("outbreaks").first()) !== null;
  },
});

/** Internal-only fetch by source id, for tests and operator debugging. */
export const getBySourceId = internalQuery({
  args: { sourceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("outbreaks")
      .withIndex("by_source_id", (q) => q.eq("source", "cdc").eq("sourceId", args.sourceId))
      .unique();
  },
});

// --- Public feed/detail queries (SPEC.md §8/§12) ---------------------------

const ARCHIVE_AFTER_DAYS = 365; // §10: mirrors recalls' archive-after-a-year rule

function archiveCutoffIso(now: number): string {
  return new Date(now - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * All active outbreaks plus resolved ones within the archive window, newest
 * first. Unlike recalls.list this isn't paginated: CDC's own landing page
 * only ever lists a handful of current investigations (§3 "no clean
 * structured API"), so the whole table comfortably fits one reactive query —
 * the Feed page merges this with the paginated recall stream for display.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = archiveCutoffIso(Date.now());
    const all = await ctx.db.query("outbreaks").withIndex("by_published_at").order("desc").take(300);
    return all.filter((o) => o.status === "active" || o.publishedAt >= cutoff);
  },
});

export const get = query({
  args: { id: v.id("outbreaks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Full-text search over outbreaks (§10), the outbreak counterpart to
 * recalls.search. The table is tiny (§3: CDC only lists current
 * investigations), so like `list` it isn't paginated — the search page merges
 * the top hits into the paginated recall stream by date.
 */
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const term = normalizeSearchQuery(args.query);
    if (!term) return [];
    return await ctx.db
      .query("outbreaks")
      .withSearchIndex("search_text", (q) => q.search("searchText", term))
      .take(20);
  },
});
