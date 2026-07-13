import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { setupConvex, createUser, asUser } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

// Phase 5 authorization gate (SPEC.md §14): a member of household A cannot read
// or write household B, on both queries and mutations. Because every function
// resolves the caller's own member row and only ever touches that member's
// household, cross-household access isn't expressible — these tests assert that
// property end to end, plus onboarding, owner-only guards, export, and deletion.

type Answers = {
  householdName: string;
  location: { states: string[]; stores: string[] };
  people: {
    members: Array<{ ageBand: "infant" | "child" | "adult" | "older_adult"; label?: string }>;
    pets: Array<"dog" | "cat" | "other">;
  };
  allergens: string[];
  notifications: { preset: "recommended" | "everything" | "digest_only"; timezone: string };
};

function answers(overrides: Partial<Answers> = {}): Answers {
  return {
    householdName: "Test Household",
    location: { states: ["NC"], stores: [] },
    people: { members: [{ ageBand: "adult" }], pets: [] },
    allergens: [],
    notifications: { preset: "recommended", timezone: "America/New_York" },
    ...overrides,
  };
}

async function onboard(
  t: ReturnType<typeof setupConvex>,
  email: string,
  overrides: Partial<Answers> = {},
): Promise<{ userId: Id<"users">; as: ReturnType<typeof asUser> }> {
  const userId = await createUser(t, email);
  const as = asUser(t, userId);
  await as.mutation(api.household.completeOnboarding, { answers: answers(overrides) });
  return { userId, as };
}

describe("onboarding + context", () => {
  test("getMyContext reflects signed-out, pre-onboarding, and onboarded states", async () => {
    const t = setupConvex();
    expect(await t.query(api.household.getMyContext, {})).toMatchObject({
      signedIn: false,
      hasHousehold: false,
    });

    const userId = await createUser(t, "a@example.com");
    const as = asUser(t, userId);
    expect(await as.query(api.household.getMyContext, {})).toMatchObject({
      signedIn: true,
      hasHousehold: false,
      needsOnboarding: true,
    });

    await as.mutation(api.household.completeOnboarding, {
      answers: answers({ householdName: "Alpha" }),
    });
    expect(await as.query(api.household.getMyContext, {})).toMatchObject({
      signedIn: true,
      hasHousehold: true,
      role: "owner",
      householdName: "Alpha",
    });
  });

  test("completeOnboarding uses the verified email as the owner's channel", async () => {
    const t = setupConvex();
    const { as } = await onboard(t, "owner@example.com");
    const members = await as.query(api.household.listMembers, {});
    expect(members).toEqual([
      { email: "owner@example.com", role: "owner", linked: true, isSelf: true },
    ]);
  });

  test("a second onboarding for the same user is rejected", async () => {
    const t = setupConvex();
    const { as } = await onboard(t, "a@example.com");
    await expect(
      as.mutation(api.household.completeOnboarding, { answers: answers() }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("authorization isolation (§14)", () => {
  test("each user reads only their own household", async () => {
    const t = setupConvex();
    const alpha = await onboard(t, "alpha@example.com", {
      householdName: "Alpha", location: { states: ["NC"], stores: [] },
    });
    const beta = await onboard(t, "beta@example.com", {
      householdName: "Beta", location: { states: ["TX"], stores: [] },
    });

    const alphaSummary = await alpha.as.query(api.household.getMySummary, {});
    const betaSummary = await beta.as.query(api.household.getMySummary, {});
    expect(alphaSummary!.householdName).toBe("Alpha");
    expect(alphaSummary!.states).toEqual(["NC"]);
    expect(betaSummary!.householdName).toBe("Beta");
    expect(betaSummary!.states).toEqual(["TX"]);
  });

  test("a write by one household never touches another", async () => {
    const t = setupConvex();
    const alpha = await onboard(t, "alpha@example.com", { householdName: "Alpha" });
    const beta = await onboard(t, "beta@example.com", { householdName: "Beta" });

    await beta.as.mutation(api.household.updatePreferences, { states: ["CA", "OR"] });

    // Alpha is unchanged; Beta got exactly its own edit.
    expect((await alpha.as.query(api.household.getMySummary, {}))!.states).toEqual(["NC"]);
    expect((await beta.as.query(api.household.getMySummary, {}))!.states).toEqual(["CA", "OR"]);
  });

  test("unauthenticated reads are empty and writes throw", async () => {
    const t = setupConvex();
    await onboard(t, "alpha@example.com");
    expect(await t.query(api.household.getMySummary, {})).toBeNull();
    await expect(t.mutation(api.household.updatePreferences, { states: ["NV"] })).rejects.toThrow(
      ConvexError,
    );
  });
});

describe("owner-only guards", () => {
  test("a non-owner member cannot redo setup", async () => {
    const t = setupConvex();
    const { as, userId } = await onboard(t, "owner@example.com");

    // Add a second member (role 'member') bound to another user, as invite
    // acceptance would.
    const memberUserId = await createUser(t, "member@example.com");
    await t.run(async (ctx) => {
      const owner = await ctx.db
        .query("members")
        .withIndex("by_auth_user", (q) => q.eq("authUserId", userId))
        .unique();
      await ctx.db.insert("members", {
        householdId: owner!.householdId,
        email: "member@example.com",
        role: "member",
        authUserId: memberUserId,
      });
    });
    const memberAs = asUser(t, memberUserId);

    await expect(
      memberAs.mutation(api.household.redoSetup, { answers: answers({ householdName: "Hijack" }) }),
    ).rejects.toThrow(ConvexError);
    // Owner can.
    await as.mutation(api.household.redoSetup, { answers: answers({ householdName: "Renamed" }) });
    expect((await as.query(api.household.getMySummary, {}))!.householdName).toBe("Renamed");
  });
});

describe("export + deletion (§2)", () => {
  test("exportData returns the caller's own household data", async () => {
    const t = setupConvex();
    const { as } = await onboard(t, "owner@example.com", {
      householdName: "Exporters",
      allergens: ["milk"],
    });
    const dump = await as.query(api.household.exportData, {});
    expect(dump.household.name).toBe("Exporters");
    expect(dump.preferences!.allergens).toEqual(["milk"]);
    expect(dump.accounts).toEqual([{ email: "owner@example.com", role: "owner" }]);
  });

  test("deleting the last account tears down the household", async () => {
    const t = setupConvex();
    const { as, userId } = await onboard(t, "solo@example.com");
    const result = await as.mutation(api.household.deleteAccount, {});
    expect(result.deletedHousehold).toBe(true);

    await t.run(async (ctx) => {
      expect(await ctx.db.query("households").collect()).toHaveLength(0);
      expect(await ctx.db.query("householdPreferences").collect()).toHaveLength(0);
      expect(await ctx.db.query("members").collect()).toHaveLength(0);
      expect(await ctx.db.get(userId)).toBeNull();
    });
  });

  test("deleting a non-last account keeps the household", async () => {
    const t = setupConvex();
    const { as, userId } = await onboard(t, "owner@example.com");
    const memberUserId = await createUser(t, "member@example.com");
    await t.run(async (ctx) => {
      const owner = await ctx.db
        .query("members")
        .withIndex("by_auth_user", (q) => q.eq("authUserId", userId))
        .unique();
      await ctx.db.insert("members", {
        householdId: owner!.householdId,
        email: "member@example.com",
        role: "member",
        authUserId: memberUserId,
      });
    });

    const result = await asUser(t, memberUserId).mutation(api.household.deleteAccount, {});
    expect(result.deletedHousehold).toBe(false);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("households").collect()).toHaveLength(1);
      expect(await ctx.db.query("members").collect()).toHaveLength(1);
    });
    // The owner still reads their household fine.
    expect((await as.query(api.household.getMySummary, {}))!.role).toBe("owner");
  });
});
