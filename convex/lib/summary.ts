// §11 Step 5: "What counts as relevant to your household" — the banner sentence
// and the detail rows must be generated from the same stored values, so both are
// derived here from the stored preference document and nowhere else.

type SummaryInput = {
  states: string[];
  allergens: string[];
  pets: Array<"dog" | "cat" | "other">;
  members: Array<{
    ageBand: "infant" | "child" | "adult" | "older_adult";
    pregnant?: boolean;
    immunocompromised?: boolean;
  }>;
  preset: "recommended" | "everything" | "digest_only";
};

const PRESET_LABELS: Record<SummaryInput["preset"], string> = {
  recommended: "Recommended alerts",
  everything: "Everything, instantly",
  digest_only: "Digest only",
};

// [singular, plural]. "adult 65+" matches the band's label everywhere else
// ("Adult 65+"), and pluralizes the noun, not the "65+" (UX-11).
const AGE_BAND_NOUNS: Record<SummaryInput["members"][number]["ageBand"], [string, string]> = {
  infant: ["infant", "infants"],
  child: ["kid", "kids"],
  adult: ["adult", "adults"],
  older_adult: ["adult 65+", "adults 65+"],
};

function countNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatAllergen(allergen: string): string {
  return allergen.replace(/_/g, " ");
}

/**
 * One-line recap, e.g. "Recalls in NC · milk & peanut allergens · 1 infant ·
 * 1 dog · Recommended alerts". Used by the seed recap now and the Household
 * tab / onboarding Step 5 later.
 */
export function buildHouseholdSummary(input: SummaryInput): string {
  const parts: string[] = [];

  parts.push(
    input.states.length > 0
      ? `Recalls in ${input.states.join(", ")}`
      : "Recalls nationwide",
  );

  if (input.allergens.length > 0) {
    const names = input.allergens.map(formatAllergen);
    const joined =
      names.length === 1
        ? names[0]!
        : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]!}`;
    parts.push(`${joined} allergen${names.length === 1 ? "" : "s"}`);
  }

  const bandCounts = new Map<SummaryInput["members"][number]["ageBand"], number>();
  for (const member of input.members) {
    bandCounts.set(member.ageBand, (bandCounts.get(member.ageBand) ?? 0) + 1);
  }
  for (const [band, count] of bandCounts) {
    const [one, many] = AGE_BAND_NOUNS[band];
    parts.push(`${count} ${count === 1 ? one : many}`);
  }

  const petCounts = new Map<string, number>();
  for (const pet of input.pets) petCounts.set(pet, (petCounts.get(pet) ?? 0) + 1);
  for (const [pet, count] of petCounts) parts.push(countNoun(count, pet));

  parts.push(PRESET_LABELS[input.preset]);

  return parts.join(" · ");
}
