import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentMember, requireMember } from "./lib/auth";

// Push opt-in/opt-out (SPEC.md §9 contextual permission flow). Scoped to the
// caller's own member via Convex Auth (Phase 5) — the subscription belongs to
// the individual member (§2), so it's read/written only for that member. Now
// callable straight from the authenticated client; the Phase-3 pilot-secret
// Route Handlers are gone.

const pushSubscriptionValidator = v.object({
  endpoint: v.string(),
  keys: v.object({
    p256dh: v.string(),
    auth: v.string(),
  }),
  expirationTime: v.optional(v.union(v.number(), v.null())),
});

async function settingsFor(ctx: QueryCtx, memberId: Id<"members">) {
  return await ctx.db
    .query("notificationSettings")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();
}

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const member = await getCurrentMember(ctx);
    if (!member) return null;
    const settings = await settingsFor(ctx, member._id);
    if (!settings) return null;
    return {
      pushOptIn: settings.pushOptIn,
      hasSubscription: settings.pushSubscription !== undefined,
    };
  },
});

export const subscribe = mutation({
  args: { subscription: pushSubscriptionValidator },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const settings = await settingsFor(ctx, member._id);
    if (!settings) throw new ConvexError({ code: "no_settings" });
    await ctx.db.patch(settings._id, {
      pushOptIn: true,
      pushSubscription: args.subscription,
    });
    return { ok: true as const };
  },
});

export const unsubscribe = mutation({
  args: {},
  handler: async (ctx) => {
    const member = await requireMember(ctx);
    const settings = await settingsFor(ctx, member._id);
    if (!settings) return { ok: true as const };
    await ctx.db.patch(settings._id, {
      pushOptIn: false,
      pushSubscription: undefined,
    });
    return { ok: true as const };
  },
});

/** Cleared by convex/push.ts when the push service reports a subscription gone (404/410). */
export const clearSubscription = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique();
    if (!settings) return;
    await ctx.db.patch(settings._id, {
      pushOptIn: false,
      pushSubscription: undefined,
    });
  },
});
