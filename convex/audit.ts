import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Operator tooling, not product API — internal-only queries used from the CLI
// for the §14 Phase 0 exit checks (enrichment spot-check, backfill
// verification). Both paginate so no call approaches Convex's 16MB read limit
// even after the full openFDA backfill.

/** Count one page of recalls; loop from the CLI with the returned cursor. */
export const countPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    source: v.optional(v.union(v.literal("fda"), v.literal("fsis"))),
  },
  handler: async (ctx, args) => {
    const query = args.source
      ? ctx.db
          .query("recalls")
          .withIndex("by_source_id", (q) => q.eq("source", args.source!))
      : ctx.db.query("recalls");
    const page = await query.paginate({ numItems: 500, cursor: args.cursor });
    return { count: page.page.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * One page of compact records for the §14 enrichment spot-check: just the
 * text enrichment ran on plus the tags it produced, so a human can judge
 * allergen recall and audience accuracy without pulling full documents.
 */
export const samplePage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    // Stratification: sample newest-first within records at or before this
    // ISO date, letting the CLI pull strata from different eras of the table.
    beforeDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("recalls")
      .withIndex("by_recall_date", (q) =>
        args.beforeDate ? q.lte("recallDate", args.beforeDate) : q,
      )
      .order("desc")
      .paginate({ numItems: args.numItems, cursor: args.cursor });

    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      records: page.page.map((doc) => {
        const raw = doc.raw as Record<string, unknown> | null;
        const reason =
          typeof raw?.reason_for_recall === "string"
            ? raw.reason_for_recall
            : typeof raw?.field_recall_reason === "string"
              ? raw.field_recall_reason
              : "";
        return {
          source: doc.source,
          sourceId: doc.sourceId,
          productDesc: doc.productDesc.slice(0, 200),
          reason: reason.slice(0, 300),
          firm: doc.firm.slice(0, 80),
          allergens: doc.allergens,
          audience: doc.audience,
          hazardType: doc.hazardType,
        };
      }),
    };
  },
});
