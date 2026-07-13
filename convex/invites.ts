import { mutation, query, internalAction, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getCurrentMember, requireOwner, requireUserId } from "./lib/auth";
import { createMemberWithSettings, newToken } from "./lib/members";
import { sendEmail } from "./lib/email";

// Household invitations with roles (SPEC.md §2). The owner emails a tokenized
// invite; the invitee signs in with that same address (email verified by the
// OTP flow) and accepts, which binds a member row to their auth user. Because
// acceptance requires the invitee's verified email to match the invite, only
// the intended recipient can join.

const roleValidator = v.union(v.literal("owner"), v.literal("member"));

function inviteUrl(token: string): string {
  const base = (process.env.APP_BASE_URL ?? "https://foodrecalls.app").replace(/\/$/, "");
  return `${base}/invite/${token}`;
}

// ---------------------------------------------------------------------------
// Owner-facing
// ---------------------------------------------------------------------------

export const listInvites = query({
  args: {},
  handler: async (ctx) => {
    const { household } = await requireOwner(ctx);
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect();
    return invites
      .filter((i) => i.status === "pending")
      .map((i) => ({ token: i.token, email: i.email, role: i.role, createdAt: i.createdAt }));
  },
});

export const createInvite = mutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const { household, member } = await requireOwner(ctx);
    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError({ code: "bad_email", message: "Enter a valid email address." });
    }

    // Already an account in this household?
    const members = await ctx.db
      .query("members")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect();
    if (members.some((m) => m.email.toLowerCase() === email)) {
      throw new ConvexError({ code: "already_member", message: "That person is already in your household." });
    }

    // Reuse an existing pending invite for the same address rather than piling up.
    const existing = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const pending = existing.find(
      (i) => i.householdId === household._id && i.status === "pending",
    );

    let token: string;
    if (pending) {
      token = pending.token;
      await ctx.db.patch(pending._id, { role: args.role, createdAt: Date.now() });
    } else {
      token = newToken();
      await ctx.db.insert("invites", {
        householdId: household._id,
        email,
        role: args.role,
        token,
        status: "pending",
        invitedByMemberId: member._id,
        createdAt: Date.now(),
      });
    }

    await ctx.scheduler.runAfter(0, internal.invites.sendInviteEmail, { token });
    return { ok: true as const };
  },
});

export const revokeInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const { household } = await requireOwner(ctx);
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite || invite.householdId !== household._id) {
      throw new ConvexError({ code: "not_found", message: "Invite not found." });
    }
    await ctx.db.patch(invite._id, { status: "revoked" });
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// Invitee-facing
// ---------------------------------------------------------------------------

/** Public preview for the accept page — household name + invited email only. */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite) return null;
    const household = await ctx.db.get(invite.householdId);
    return {
      status: invite.status,
      email: invite.email,
      role: invite.role,
      householdName: household?.name ?? "a household",
    };
  },
});

export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    // One household per user.
    const existingMember = await getCurrentMember(ctx);
    if (existingMember) {
      throw new ConvexError({
        code: "already_member",
        message: "This account already belongs to a household.",
      });
    }

    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite || invite.status !== "pending") {
      throw new ConvexError({ code: "invalid_invite", message: "This invite is no longer valid." });
    }

    // The signed-in user's verified email must match the invited address.
    const user = await ctx.db.get(userId);
    const userEmail = typeof user?.email === "string" ? user.email.toLowerCase() : null;
    if (userEmail !== invite.email.toLowerCase()) {
      throw new ConvexError({
        code: "email_mismatch",
        message: "Sign in with the email this invite was sent to.",
      });
    }

    await createMemberWithSettings(ctx, {
      householdId: invite.householdId,
      email: invite.email,
      role: invite.role,
      authUserId: userId,
      preset: "recommended",
      timezone: "America/New_York",
    });
    await ctx.db.patch(invite._id, { status: "accepted", acceptedAt: Date.now() });
    return { householdId: invite.householdId };
  },
});

// ---------------------------------------------------------------------------
// Email delivery (scheduled from createInvite; needs an action to fetch Resend)
// ---------------------------------------------------------------------------

export const getInviteForEmail = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite || invite.status !== "pending") return null;
    const household = await ctx.db.get(invite.householdId);
    return { email: invite.email, householdName: household?.name ?? "a household", token: invite.token };
  },
});

export const sendInviteEmail = internalAction({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.runQuery(internal.invites.getInviteForEmail, { token: args.token });
    if (!invite) return;
    const url = inviteUrl(invite.token);
    await sendEmail({
      to: invite.email,
      subject: `You're invited to ${invite.householdName} on Food Recalls`,
      text: [
        `You've been invited to join ${invite.householdName} on Food Recalls —`,
        "recall alerts tailored to your household.",
        "",
        `Accept your invite: ${url}`,
        "",
        "Sign in with this email address to accept. If you weren't expecting this,",
        "you can ignore this email.",
      ].join("\n"),
    });
  },
});
