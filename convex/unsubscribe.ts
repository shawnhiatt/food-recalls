import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// One-click email unsubscribe (SPEC.md §2). Token-based, no login: every email
// footer carries a link to /unsubscribe?token=<unsubscribeToken>. The page
// previews which address it affects, then flips emailOptIn off in a single
// click. Push and in-app are untouched — this only silences email.

export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", args.token))
      .unique();
    if (!settings) return null;
    const member = await ctx.db.get(settings.memberId);
    return { email: member?.email ?? null, alreadyUnsubscribed: !settings.emailOptIn };
  },
});

export const unsubscribe = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", args.token))
      .unique();
    if (!settings) return { ok: false as const };
    if (settings.emailOptIn) await ctx.db.patch(settings._id, { emailOptIn: false });
    const member = await ctx.db.get(settings.memberId);
    return { ok: true as const, email: member?.email ?? null };
  },
});
