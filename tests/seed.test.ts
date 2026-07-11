import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { deriveMemberLabels } from "../convex/seed";
import { buildHouseholdSummary } from "../convex/lib/summary";
import { setupConvex } from "./helpers";

describe("deriveMemberLabels (§11: derive, then pin)", () => {
  test("labels derive from age bands, numbered only for duplicates", () => {
    expect(
      deriveMemberLabels([
        { ageBand: "adult" },
        { ageBand: "adult" },
        { ageBand: "child" },
      ]),
    ).toEqual([
      { label: "Adult", labelPinned: false },
      { label: "Adult 2", labelPinned: false },
      { label: "Kid", labelPinned: false },
    ]);
  });

  test("a provided label is a manual rename and pins", () => {
    expect(deriveMemberLabels([{ label: "Grandma", ageBand: "older_adult" }])).toEqual([
      { label: "Grandma", labelPinned: true },
    ]);
  });
});

describe("buildHouseholdSummary (§11 Step 5: banner derives from stored values)", () => {
  test("spec example shape", () => {
    expect(
      buildHouseholdSummary({
        states: ["NC"],
        allergens: ["milk", "peanuts"],
        pets: ["dog"],
        members: [{ ageBand: "infant" }],
        preset: "recommended",
      }),
    ).toBe("Recalls in NC · milk & peanuts allergens · 1 infant · 1 dog · Recommended alerts");
  });

  test("pilot household shape", () => {
    expect(
      buildHouseholdSummary({
        states: ["NC"],
        allergens: [],
        pets: [],
        members: [{ ageBand: "adult" }, { ageBand: "adult" }, { ageBand: "child" }],
        preset: "recommended",
      }),
    ).toBe("Recalls in NC · 2 adults · 1 kid · Recommended alerts");
  });
});

describe("seedDefaultHousehold", () => {
  test("seeds household, preferences, members, and notification settings", async () => {
    const t = setupConvex();
    const result = await t.mutation(internal.seed.seedDefaultHousehold, {});
    if (result.status !== "seeded") throw new Error("expected a fresh seed");
    expect(result.summary).toBe("Recalls in NC · 2 adults · 1 kid · Recommended alerts");

    await t.run(async (ctx) => {
      const households = await ctx.db.query("households").collect();
      expect(households).toHaveLength(1);
      expect(households[0]!.onboardingCompletedAt).toBeGreaterThan(0);

      const prefs = await ctx.db.query("householdPreferences").collect();
      expect(prefs).toHaveLength(1);
      expect(prefs[0]).toMatchObject({
        householdId: households[0]!._id,
        states: ["NC"],
        categories: { humanFood: true, petFood: false, outbreaks: true },
      });
      expect(prefs[0]!.members.map((m) => m.label)).toEqual(["Adult", "Adult 2", "Kid"]);

      // Only members with an email become notifiable member records (§2:
      // channels belong to individual members).
      const members = await ctx.db.query("members").collect();
      expect(members).toHaveLength(1);

      const settings = await ctx.db.query("notificationSettings").collect();
      expect(settings).toHaveLength(1);
      expect(settings[0]).toMatchObject({
        memberId: members[0]!._id,
        emailOptIn: true,
        pushOptIn: false, // push is never opted in by default (§9)
        urgencyThreshold: "class1_plus_allergen", // "Recommended" default
        digestEnabled: true,
        digestHour: 17,
      });
    });
  });

  test("re-running the seed is idempotent", async () => {
    const t = setupConvex();
    await t.mutation(internal.seed.seedDefaultHousehold, {});
    const second = await t.mutation(internal.seed.seedDefaultHousehold, {});
    expect(second.status).toBe("already-seeded");

    await t.run(async (ctx) => {
      expect(await ctx.db.query("households").collect()).toHaveLength(1);
      expect(await ctx.db.query("householdPreferences").collect()).toHaveLength(1);
    });
  });

  test("seedHousehold accepts custom questionnaire answers", async () => {
    const t = setupConvex();
    const result = await t.mutation(internal.seed.seedHousehold, {
      answers: {
        householdName: "Test household",
        location: { states: ["TX", "OK"], stores: ["H-E-B"] },
        people: {
          members: [
            { label: "Mo", ageBand: "adult", email: "mo@example.com" },
            { ageBand: "infant" },
          ],
          pets: ["cat"],
        },
        allergens: ["peanuts"],
        notifications: { preset: "everything", timezone: "America/Chicago" },
      },
    });
    if (result.status !== "seeded") throw new Error("expected a fresh seed");
    expect(result.summary).toBe(
      "Recalls in TX, OK · peanuts allergen · 1 adult · 1 infant · 1 cat · Everything, instantly",
    );

    await t.run(async (ctx) => {
      const prefs = (await ctx.db.query("householdPreferences").collect())[0]!;
      expect(prefs.chains).toEqual(["H-E-B"]);
      expect(prefs.categories.petFood).toBe(true);
      expect(prefs.members[0]).toMatchObject({ label: "Mo", labelPinned: true });
      const settings = (await ctx.db.query("notificationSettings").collect())[0]!;
      expect(settings.urgencyThreshold).toBe("everything");
      expect(settings.timezone).toBe("America/Chicago");
    });
  });
});
