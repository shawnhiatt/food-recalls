import { convexTest } from "convex-test";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

// convex-test needs the function modules; this glob mirrors the convex/ dir.
export const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

export function setupConvex() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setupConvex>;

/**
 * Insert a Convex Auth user and return an identity-scoped client. `getAuthUserId`
 * reads `identity.subject` up to the first "|", so a bare users doc id is a
 * valid subject — this is how convex-test simulates a signed-in user.
 */
export async function createUser(t: T, email: string): Promise<Id<"users">> {
  return await t.run((ctx) => ctx.db.insert("users", { email }));
}

export function asUser(t: T, userId: Id<"users">) {
  return t.withIdentity({ subject: userId });
}

/** Link an existing (seeded) member row to an auth user, as claim-by-email would. */
export async function linkMemberToUser(
  t: T,
  memberId: Id<"members">,
  userId: Id<"users">,
): Promise<void> {
  await t.run((ctx) => ctx.db.patch(memberId, { authUserId: userId }));
}
