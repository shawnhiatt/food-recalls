import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Bookmarks (SPEC.md §12 "Saved" tab, detail-view bookmark action). Not in
// §2's sensitive-data list (age bands, allergies, pregnancy, emails) — just
// "this recall was saved" — so these stay plain public functions, fully
// live-reactive, unlike household.ts's secret-gated query.
//
// Single-household pilot simplification: resolves "the" member instead of
// taking a caller-supplied memberId, since no auth exists until Phase 5 and
// there's exactly one household during the pilot (§2, §17).
async function getPilotMember(ctx: QueryCtx | MutationCtx) {
  return await ctx.db.query("members").first();
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const member = await getPilotMember(ctx);
    if (!member) return [];

    const bookmarks = await ctx.db
      .query("bookmarks")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .collect();

    // Outbreak bookmarks aren't possible yet (outbreaks arrive Phase 4); skip
    // rather than crash if one somehow exists.
    const entries = await Promise.all(
      bookmarks
        .filter((b) => b.alertType === "recall")
        .map(async (b) => {
          const recall = await ctx.db.get(b.alertId as Id<"recalls">);
          return recall ? { ...recall, bookmarkId: b._id, bookmarkedAt: b.createdAt } : null;
        }),
    );

    return entries
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.bookmarkedAt - a.bookmarkedAt);
  },
});

/** Powers the bookmark button's filled/outline state on a single detail view. */
export const isBookmarked = query({
  args: { alertId: v.string() },
  handler: async (ctx, args) => {
    const member = await getPilotMember(ctx);
    if (!member) return false;
    const existing = await ctx.db
      .query("bookmarks")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .filter((q) => q.eq(q.field("alertId"), args.alertId))
      .unique();
    return existing !== null;
  },
});

export const toggle = mutation({
  args: {
    alertId: v.string(),
    alertType: v.union(v.literal("recall"), v.literal("outbreak")),
  },
  handler: async (ctx, args) => {
    const member = await getPilotMember(ctx);
    if (!member) throw new ConvexError("no pilot household seeded yet");

    const existing = await ctx.db
      .query("bookmarks")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .filter((q) => q.eq(q.field("alertId"), args.alertId))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { bookmarked: false };
    }

    await ctx.db.insert("bookmarks", {
      memberId: member._id,
      alertId: args.alertId,
      alertType: args.alertType,
      createdAt: Date.now(),
    });
    return { bookmarked: true };
  },
});
