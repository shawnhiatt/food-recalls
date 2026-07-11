import { internalMutation, internalQuery, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { normalizedRecallFields, hazardTypeValidator } from "./schema";
import type { NormalizedRecall } from "./adapters/types";

// Upsert on (source, sourceId) with content-hash revisioning (SPEC.md §4):
//   hash unchanged  → touch updatedAt only (no timeline entry, per §9 matrix)
//   hash changed    → append updateHistory entry; Phase 2 re-runs matching here
//   new record      → insert with the initial "Recall" timeline entry
// All functions are internal: Phase 0 has no UI and the pilot exposes nothing
// publicly (§2).

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
        await ctx.db.insert("recalls", {
          ...record,
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
        continue;
      }

      if (existing.contentHash === record.contentHash) {
        await ctx.db.patch(existing._id, { updatedAt: now });
        counts.touched++;
        continue;
      }

      // Material update: new revision. Phase 2 hooks matching + notification
      // dispatch here (decision matrix §9, "Material update" rows).
      const entry = {
        date: new Date(now).toISOString().slice(0, 10),
        label: `Update ${existing.updateHistory.length}`,
        summary: diffSummary(toNormalized(existing), record as NormalizedRecall),
        contentHash: record.contentHash,
      };
      await ctx.db.patch(existing._id, {
        ...record,
        updateHistory: [...existing.updateHistory, entry],
        updatedAt: now,
      });
      counts.materialUpdates++;
    }

    return counts;
  },
});

function toNormalized(doc: Doc<"recalls">): NormalizedRecall {
  const { _id, _creationTime, updateHistory, firstSeenAt, updatedAt, ...rest } = doc;
  return rest as NormalizedRecall;
}

/** Internal-only count, used by ingest anomaly detection and tests. */
export const countBySource = internalQuery({
  args: { source: v.union(v.literal("fda"), v.literal("fsis")) },
  handler: async (ctx, args): Promise<number> => {
    // Fine at pilot scale; swap for a counter document if the table grows huge.
    const docs = await ctx.db
      .query("recalls")
      .withIndex("by_source_id", (q) => q.eq("source", args.source))
      .collect();
    return docs.length;
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
