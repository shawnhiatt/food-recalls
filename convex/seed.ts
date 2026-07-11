import { internalMutation, type MutationCtx } from "./_generated/server";
import { v, type Infer } from "convex/values";
import { buildHouseholdSummary } from "./lib/summary";

// Pilot household seed (SPEC.md Phase 0). The arguments mirror the §11
// onboarding questionnaire step-for-step so the Phase 5 onboarding UI can reuse
// this exact structure. Internal-only: preference data is never publicly
// readable or writable during the pilot (§2).
//
// Run with:   npx convex run seed:seedDefaultHousehold
// or with custom answers:
//   npx convex run seed:seedHousehold '{"answers": { ... }}'

const ageBandValidator = v.union(
  v.literal("infant"),
  v.literal("child"),
  v.literal("adult"),
  v.literal("older_adult"),
);

const questionnaireValidator = v.object({
  householdName: v.string(),

  // Step 1 — Where you are (required; the only non-skippable step)
  location: v.object({
    states: v.array(v.string()), // primary state first
    stores: v.array(v.string()),
  }),

  // Step 2 — Who's in your household
  people: v.object({
    members: v.array(
      v.object({
        // Omitted label = derive from age band (§11: labels derive, then pin).
        label: v.optional(v.string()),
        ageBand: ageBandValidator,
        pregnant: v.optional(v.boolean()),
        immunocompromised: v.optional(v.boolean()),
        // Notification channels belong to individual members (§2).
        email: v.optional(v.string()),
      }),
    ),
    pets: v.array(v.union(v.literal("dog"), v.literal("cat"), v.literal("other"))),
  }),

  // Step 3 — Allergens (big-nine subset)
  allergens: v.array(v.string()),

  // Step 4 — How you want to hear about it
  notifications: v.object({
    preset: v.union(
      v.literal("recommended"),
      v.literal("everything"),
      v.literal("digest_only"),
    ),
    timezone: v.string(),
  }),

  // Extra matching dimensions editable later in the Household tab
  brands: v.optional(v.array(v.string())),
  keywords: v.optional(v.array(v.string())),
});

type Questionnaire = Infer<typeof questionnaireValidator>;

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

const AGE_BAND_DEFAULT_LABELS = {
  infant: "Infant",
  child: "Kid",
  adult: "Adult",
  older_adult: "Adult 65+",
} as const;

/**
 * §11 Step 2: default labels derive from the age band, numbered only for
 * duplicates ("Adult", "Adult 2"). A caller-provided label is treated as a
 * manual rename and pinned.
 */
export function deriveMemberLabels(
  members: Array<{ label?: string; ageBand: keyof typeof AGE_BAND_DEFAULT_LABELS }>,
): Array<{ label: string; labelPinned: boolean }> {
  const seen = new Map<string, number>();
  return members.map((member) => {
    if (member.label && member.label.trim()) {
      return { label: member.label.trim(), labelPinned: true };
    }
    const base = AGE_BAND_DEFAULT_LABELS[member.ageBand];
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { label: count === 1 ? base : `${base} ${count}`, labelPinned: false };
  });
}

const PRESET_SETTINGS = {
  recommended: {
    urgencyThreshold: "class1_plus_allergen" as const,
    digestEnabled: true,
  },
  everything: {
    urgencyThreshold: "everything" as const,
    digestEnabled: true,
  },
  digest_only: {
    // Digest only: nothing meets the instant bar except the §9 hard floor,
    // which is threshold-independent by design.
    urgencyThreshold: "class1_only" as const,
    digestEnabled: true,
  },
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

  const labels = deriveMemberLabels(answers.people.members);
  const preferenceMembers = answers.people.members.map((member, i) => ({
    label: labels[i]!.label,
    labelPinned: labels[i]!.labelPinned,
    ageBand: member.ageBand,
    pregnant: member.pregnant,
    immunocompromised: member.immunocompromised,
  }));

  await ctx.db.insert("householdPreferences", {
    householdId,
    states: answers.location.states,
    brands: answers.brands ?? [],
    keywords: answers.keywords ?? [],
    chains: answers.location.stores,
    allergens: answers.allergens,
    categories: { humanFood: true, petFood: answers.people.pets.length > 0, outbreaks: true },
    pets: answers.people.pets,
    members: preferenceMembers,
  });

  // Members with an email get a login-less pilot member record + notification
  // settings; Phase 5 attaches Convex Auth users to these.
  const preset = PRESET_SETTINGS[answers.notifications.preset];
  const memberIds = [];
  for (const member of answers.people.members) {
    if (!member.email) continue;
    const memberId = await ctx.db.insert("members", {
      householdId,
      email: member.email,
    });
    await ctx.db.insert("notificationSettings", {
      memberId,
      emailOptIn: true,
      pushOptIn: false, // push is an explicit opt-in with the §9 explainer flow
      urgencyThreshold: preset.urgencyThreshold,
      digestEnabled: preset.digestEnabled,
      digestHour: 17,
      timezone: answers.notifications.timezone,
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
