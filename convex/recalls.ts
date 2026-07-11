import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { normalizedRecallFields } from "./schema";
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
