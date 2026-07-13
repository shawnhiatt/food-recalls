import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { setupConvex, createUser, asUser } from "./helpers";

// Household invitations with roles (SPEC.md §2). An owner invites by email; the
// invitee must sign in with that same verified address to accept, so only the
// intended recipient can join.

// createInvite schedules the invite-email action; fake timers let us drain it
// deterministically (matching notifications.test) so it never completes after
// teardown.
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-13T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

const ownerAnswers = {
  householdName: "Alpha",
  location: { states: ["NC"], stores: [] },
  people: { members: [{ ageBand: "adult" as const }], pets: [] },
  allergens: [],
  notifications: { preset: "recommended" as const, timezone: "America/New_York" },
};

async function onboardOwner(t: ReturnType<typeof setupConvex>, email: string) {
  const userId = await createUser(t, email);
  const as = asUser(t, userId);
  await as.mutation(api.household.completeOnboarding, { answers: ownerAnswers });
  return as;
}

describe("invites", () => {
  test("owner invites; invitee with the matching email accepts and joins", async () => {
    const t = setupConvex();
    const owner = await onboardOwner(t, "owner@example.com");
    await owner.mutation(api.invites.createInvite, {
      email: "invitee@example.com",
      role: "member",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const pending = await owner.query(api.invites.listInvites, {});
    expect(pending).toHaveLength(1);
    expect(pending[0]!.email).toBe("invitee@example.com");
    const token = pending[0]!.token;

    // The invitee signs in with the invited address and accepts.
    const inviteeUser = await createUser(t, "invitee@example.com");
    const invitee = asUser(t, inviteeUser);
    const preview = await invitee.query(api.invites.getByToken, { token });
    expect(preview).toMatchObject({ status: "pending", householdName: "Alpha", role: "member" });

    await invitee.mutation(api.invites.acceptInvite, { token });

    const ctx = await invitee.query(api.household.getMyContext, {});
    expect(ctx).toMatchObject({ hasHousehold: true, role: "member", householdName: "Alpha" });
    // Now visible to the owner's member list.
    const members = await owner.query(api.household.listMembers, {});
    expect(members.map((m) => m.email).sort()).toEqual([
      "invitee@example.com",
      "owner@example.com",
    ]);
  });

  test("accepting with a different email than invited is rejected", async () => {
    const t = setupConvex();
    const owner = await onboardOwner(t, "owner@example.com");
    await owner.mutation(api.invites.createInvite, { email: "invitee@example.com", role: "member" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const token = (await owner.query(api.invites.listInvites, {}))[0]!.token;

    const wrongUser = await createUser(t, "someoneelse@example.com");
    await expect(
      asUser(t, wrongUser).mutation(api.invites.acceptInvite, { token }),
    ).rejects.toThrow(ConvexError);
  });

  test("a non-owner cannot create invites", async () => {
    const t = setupConvex();
    const stranger = await createUser(t, "stranger@example.com");
    await expect(
      asUser(t, stranger).mutation(api.invites.createInvite, {
        email: "x@example.com",
        role: "member",
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("revoked invites can no longer be accepted", async () => {
    const t = setupConvex();
    const owner = await onboardOwner(t, "owner@example.com");
    await owner.mutation(api.invites.createInvite, { email: "invitee@example.com", role: "member" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const token = (await owner.query(api.invites.listInvites, {}))[0]!.token;
    await owner.mutation(api.invites.revokeInvite, { token });

    const inviteeUser = await createUser(t, "invitee@example.com");
    await expect(
      asUser(t, inviteeUser).mutation(api.invites.acceptInvite, { token }),
    ).rejects.toThrow(ConvexError);
  });
});
