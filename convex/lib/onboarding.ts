import { v, type Infer } from "convex/values";

// Shared onboarding-questionnaire logic (SPEC.md §11). Extracted so the three
// call sites agree on one structure and one derivation:
//   - seed.ts               (pilot household, internal)
//   - household.ts          completeOnboarding (Phase 5 first-run)
//   - household.ts          redoSetup ("Redo setup", §11 re-runnable)
// The questionnaire args mirror the §11 steps one-for-one.

export const ageBandValidator = v.union(
  v.literal("infant"),
  v.literal("child"),
  v.literal("adult"),
  v.literal("older_adult"),
);

export const questionnaireValidator = v.object({
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

export type Questionnaire = Infer<typeof questionnaireValidator>;

export const AGE_BAND_DEFAULT_LABELS = {
  infant: "Infant",
  child: "Kid",
  adult: "Adult",
  older_adult: "Adult 65+",
} as const;

/**
 * §11 Step 2: default labels derive from the age band, numbered only for
 * duplicates ("Adult", "Adult 2"). A caller-provided label is treated as a
 * manual rename and pinned (never auto-renamed again).
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

export const PRESET_SETTINGS = {
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

export type PresetName = keyof typeof PRESET_SETTINGS;

/** The householdPreferences fields derived from a questionnaire (no ctx). */
export function preferencesFromQuestionnaire(answers: Questionnaire) {
  const labels = deriveMemberLabels(answers.people.members);
  const members = answers.people.members.map((member, i) => ({
    label: labels[i]!.label,
    labelPinned: labels[i]!.labelPinned,
    ageBand: member.ageBand,
    pregnant: member.pregnant,
    immunocompromised: member.immunocompromised,
  }));

  return {
    states: answers.location.states,
    brands: answers.brands ?? [],
    keywords: answers.keywords ?? [],
    chains: answers.location.stores,
    allergens: answers.allergens,
    categories: {
      humanFood: true,
      petFood: answers.people.pets.length > 0,
      outbreaks: true,
    },
    pets: answers.people.pets,
    members,
  };
}
