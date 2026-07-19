import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getCurrentMember, requireMember } from "./lib/auth";

// Bookmarks (SPEC.md §12 "Saved" tab, detail-view bookmark action). Scoped to
// the caller's own member row (Phase 5 auth). Reads degrade to empty/false for
// signed-out visitors — the recall/outbreak feed and detail pages are a public
// safety surface, so an anonymous viewer sees them without a bookmark state
// rather than an error. Toggling requires sign-in.

export const list = query({
  args: {},
  handler: async (ctx) => {
    const member = await getCurrentMember(ctx);
    if (!member) return [];

    const bookmarks = await ctx.db
      .query("bookmarks")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .collect();

    const entries = await Promise.all(
      bookmarks.map(async (b) => {
        if (b.alertType === "outbreak") {
          const outbreak = await ctx.db.get(b.alertId as Id<"outbreaks">);
          return outbreak
            ? { ...outbreak, alertType: "outbreak" as const, bookmarkId: b._id, bookmarkedAt: b.createdAt }
            : null;
        }
        const recall = await ctx.db.get(b.alertId as Id<"recalls">);
        return recall
          ? { ...recall, alertType: "recall" as const, bookmarkId: b._id, bookmarkedAt: b.createdAt }
          : null;
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
    const member = await getCurrentMember(ctx);
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
    const member = await requireMember(ctx);

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
    // §15: mirror the alert's image into Convex storage on first interest, so a
    // bookmarked card keeps its photo even after the press-release URL rots.
    // Idempotent — the action no-ops if there's no image or it's already mirrored.
    if (args.alertType === "recall") {
      await ctx.scheduler.runAfter(0, internal.images.mirrorRecallImage, {
        recallId: args.alertId as Id<"recalls">,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.images.mirrorOutbreakImage, {
        outbreakId: args.alertId as Id<"outbreaks">,
      });
    }
    return { bookmarked: true };
  },
});
