import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation, type QueryCtx } from "./_generated/server";
import { requirePilotSecret } from "./lib/access";

// Push opt-in/opt-out (SPEC.md §9 contextual permission flow). Gated by the
// same pilot secret as household.ts's getPilotSummary (§2) — these still
// touch per-member notification settings, so they're never publicly callable
// without it. Called from Next.js Route Handlers (app/api/push/*), never
// directly from client-side Convex hooks, so the secret stays server-only.
//
// Single-household pilot (§2): there's no login yet, so "the member" is the
// first member with notificationSettings — the same simplification
// household.ts's getPilotSummary already makes for its preset lookup.

const pushSubscriptionValidator = v.object({
  endpoint: v.string(),
  keys: v.object({
    p256dh: v.string(),
    auth: v.string(),
  }),
  expirationTime: v.optional(v.union(v.number(), v.null())),
});

async function firstMemberWithSettings(ctx: QueryCtx) {
  const household = await ctx.db.query("households").first();
  if (!household) return null;
  const members = await ctx.db
    .query("members")
    .withIndex("by_household", (q) => q.eq("householdId", household._id))
    .collect();
  for (const member of members) {
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .unique();
    if (settings) return { member, settings };
  }
  return null;
}

export const getStatus = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requirePilotSecret(args.secret);
    const found = await firstMemberWithSettings(ctx);
    if (!found) return null;
    return {
      pushOptIn: found.settings.pushOptIn,
      hasSubscription: found.settings.pushSubscription !== undefined,
    };
  },
});

export const subscribe = mutation({
  args: { secret: v.string(), subscription: pushSubscriptionValidator },
  handler: async (ctx, args) => {
    requirePilotSecret(args.secret);
    const found = await firstMemberWithSettings(ctx);
    if (!found) {
      throw new ConvexError("no pilot household member to subscribe");
    }
    await ctx.db.patch(found.settings._id, {
      pushOptIn: true,
      pushSubscription: args.subscription,
    });
    return { ok: true as const };
  },
});

export const unsubscribe = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requirePilotSecret(args.secret);
    const found = await firstMemberWithSettings(ctx);
    if (!found) return { ok: true as const };
    await ctx.db.patch(found.settings._id, {
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
