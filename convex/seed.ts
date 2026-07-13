import { internalMutation, type MutationCtx } from "./_generated/server";
import { buildHouseholdSummary } from "./lib/summary";
import {
  PRESET_SETTINGS,
  preferencesFromQuestionnaire,
  questionnaireValidator,
  type Questionnaire,
} from "./lib/onboarding";
import { newToken } from "./lib/members";

// Pilot household seed (SPEC.md Phase 0). The arguments mirror the §11
// onboarding questionnaire step-for-step; the Phase 5 onboarding UI
// (household.completeOnboarding) reuses the same lib/onboarding structure.
// Internal-only.
//
// Run with:   npx convex run seed:seedDefaultHousehold
// or with custom answers:
//   npx convex run seed:seedHousehold '{"answers": { ... }}'

// Re-exported for tests/seed.test.ts (pure label-derivation coverage).
export { deriveMemberLabels } from "./lib/onboarding";

// The pilot household (§2: two adults, one child). Edit before running seed,
// or pass answers to seed:seedHousehold.
const DEFAULT_ANSWERS: Questionnaire = {
  householdName: "Hiatt household",
  location: {
    states: ["NC"],
    stores: [],
  },
  people: {
    members: [
      { ageBand: "adult" as const, email: "hello@shawnhiatt.com" },
      { ageBand: "adult" as const },
      { ageBand: "child" as const },
    ],
    pets: [],
  },
  allergens: [],
  notifications: {
    preset: "recommended" as const,
    timezone: "America/New_York", // v1 single-household hardcode (§15)
  },
  brands: [],
  keywords: [],
};

async function seed(ctx: MutationCtx, answers: Questionnaire) {
  // Idempotent by household name: re-running the seed replaces preferences
  // rather than duplicating households.
  const existing = await ctx.db
    .query("households")
    .filter((q) => q.eq(q.field("name"), answers.householdName))
    .unique();
  if (existing !== null) {
    return { status: "already-seeded" as const, householdId: existing._id };
  }

  const now = Date.now();
  const householdId = await ctx.db.insert("households", {
    name: answers.householdName,
    onboardingCompletedAt: now,
  });

  const preferences = preferencesFromQuestionnaire(answers);
  await ctx.db.insert("householdPreferences", { householdId, ...preferences });

  // Members with an email get a login-less pilot member record + notification
  // settings; the first is the owner. Convex Auth users attach to these on
  // first sign-in (claim-by-email, convex/lib/members.ts).
  const preset = PRESET_SETTINGS[answers.notifications.preset];
  const memberIds = [];
  let assignedOwner = false;
  for (const member of answers.people.members) {
    if (!member.email) continue;
    const role = assignedOwner ? ("member" as const) : ("owner" as const);
    assignedOwner = true;
    const memberId = await ctx.db.insert("members", {
      householdId,
      email: member.email.toLowerCase(),
      role,
    });
    await ctx.db.insert("notificationSettings", {
      memberId,
      emailOptIn: true,
      pushOptIn: false, // push is an explicit opt-in with the §9 explainer flow
      urgencyThreshold: preset.urgencyThreshold,
      digestEnabled: preset.digestEnabled,
      digestHour: 17,
      timezone: answers.notifications.timezone,
      unsubscribeToken: newToken(),
    });
    memberIds.push(memberId);
  }

  // §11 Step 5 recap — generated from the same stored values as the detail
  // rows will be, never hand-written.
  const summary = buildHouseholdSummary({
    states: answers.location.states,
    allergens: answers.allergens,
    pets: answers.people.pets,
    members: answers.people.members,
    preset: answers.notifications.preset,
  });

  return { status: "seeded" as const, householdId, memberIds, summary };
}

export const seedHousehold = internalMutation({
  args: { answers: questionnaireValidator },
  handler: async (ctx, args) => seed(ctx, args.answers),
});

export const seedDefaultHousehold = internalMutation({
  args: {},
  handler: async (ctx) => seed(ctx, DEFAULT_ANSWERS),
});
