import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { PRESET_SETTINGS, type PresetName } from "./onboarding";

// Member + notification-settings helpers shared by onboarding, invite
// acceptance, and claim-by-email (SPEC.md §2). Keeping member creation in one
// place guarantees every new member gets notificationSettings with an
// unsubscribe token and a consistent preset mapping.

/** Opaque URL-safe token (invite tokens, one-click unsubscribe tokens). */
export function newToken(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a member + its notificationSettings, returning the member id. Used
 * when the caller already owns the household context (onboarding creates the
 * owner; invite acceptance creates a member).
 */
export async function createMemberWithSettings(
  ctx: MutationCtx,
  args: {
    householdId: Id<"households">;
    email: string;
    role: "owner" | "member";
    authUserId?: Id<"users">;
    preset: PresetName;
    timezone: string;
  },
): Promise<Id<"members">> {
  const memberId = await ctx.db.insert("members", {
    householdId: args.householdId,
    email: args.email.toLowerCase(),
    role: args.role,
    authUserId: args.authUserId,
  });
  const preset = PRESET_SETTINGS[args.preset];
  await ctx.db.insert("notificationSettings", {
    memberId,
    emailOptIn: true,
    pushOptIn: false, // explicit opt-in via the §9 explainer flow
    urgencyThreshold: preset.urgencyThreshold,
    digestEnabled: preset.digestEnabled,
    digestHour: 17,
    timezone: args.timezone,
    unsubscribeToken: newToken(),
  });
  return memberId;
}

/**
 * Delete a Convex Auth user and all of its auth-owned rows (SPEC.md §2 account
 * deletion). Removes sessions + their refresh tokens, accounts + their
 * verification codes, and finally the user document — so no orphaned auth rows
 * dangle after the account is gone. Household data is deleted by the caller.
 */
export async function deleteAuthUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of refreshTokens) await ctx.db.delete(token._id);
    await ctx.db.delete(session._id);
  }

  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const code of codes) await ctx.db.delete(code._id);
    await ctx.db.delete(account._id);
  }

  await ctx.db.delete(userId);
}

/**
 * Claim-by-email (SPEC.md §2). Runs from the Convex Auth
 * `afterUserCreatedOrUpdated` callback after the user's email is verified. If
 * an unclaimed member row exists for that verified email (e.g. the pilot owner
 * seeded before auth, or a member seeded by a household), bind it to the new
 * auth user. Idempotent: a no-op once the user already has a member row.
 *
 * Safe because the email is proven by the OTP flow — a user can only ever
 * claim a member row for an address they control.
 */
export async function claimMemberForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  email: string,
): Promise<void> {
  const alreadyLinked = await ctx.db
    .query("members")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", userId))
    .unique();
  if (alreadyLinked) return;

  const normalized = email.toLowerCase();
  const candidates = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .collect();
  const unclaimed = candidates.find((m) => m.authUserId === undefined);
  if (!unclaimed) return;

  // Grant owner only if the household still has no owner (pilot data); an
  // invited member row already carries its intended role.
  const householdMembers = await ctx.db
    .query("members")
    .withIndex("by_household", (q) => q.eq("householdId", unclaimed.householdId))
    .collect();
  const hasOwner = householdMembers.some((m) => m.role === "owner");
  await ctx.db.patch(unclaimed._id, {
    authUserId: userId,
    role: unclaimed.role ?? (hasOwner ? "member" : "owner"),
  });
}
