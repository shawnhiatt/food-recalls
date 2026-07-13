import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// Per-household authorization (SPEC.md §2, the Phase 5 public gate). This
// replaces the pilot shared-secret (lib/access.ts): every sensitive function
// resolves the CALLER'S OWN member row from the authenticated user, and only
// ever reads or writes that member's household. Cross-household access is
// structurally impossible — there is no code path that reaches another
// household's data — which is exactly what the §14 authorization tests assert.
//
// Errors are ConvexErrors with a stable `code` so the frontend can distinguish
// "sign in" (unauthenticated) from "finish onboarding" (no_household) from
// "owner only" (forbidden).

type Ctx = QueryCtx | MutationCtx;

export async function currentUserId(ctx: Ctx): Promise<Id<"users"> | null> {
  return await getAuthUserId(ctx);
}

export async function requireUserId(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ code: "unauthenticated", message: "Sign in required." });
  }
  return userId;
}

/**
 * The signed-in user's member row, or null. Null legitimately means "signed in
 * but hasn't onboarded yet" — distinct from not being signed in at all. A user
 * has at most one member row (`unique()` enforces the invariant).
 */
export async function getCurrentMember(ctx: Ctx): Promise<Doc<"members"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("members")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", userId))
    .unique();
}

export async function requireMember(ctx: Ctx): Promise<Doc<"members">> {
  await requireUserId(ctx);
  const member = await getCurrentMember(ctx);
  if (!member) {
    throw new ConvexError({ code: "no_household", message: "Complete onboarding first." });
  }
  return member;
}

export async function requireHousehold(
  ctx: Ctx,
): Promise<{ member: Doc<"members">; household: Doc<"households"> }> {
  const member = await requireMember(ctx);
  const household = await ctx.db.get(member.householdId);
  if (!household) {
    // Member row orphaned from its household — treat as no household.
    throw new ConvexError({ code: "no_household", message: "No household found." });
  }
  return { member, household };
}

export async function requireOwner(
  ctx: Ctx,
): Promise<{ member: Doc<"members">; household: Doc<"households"> }> {
  const result = await requireHousehold(ctx);
  if (result.member.role !== "owner") {
    throw new ConvexError({ code: "forbidden", message: "Only the household owner can do that." });
  }
  return result;
}
