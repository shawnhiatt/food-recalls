// Plain-language copy rules (SPEC.md §11): never render agency jargon bare.

export type RiskLevel = "high" | "moderate" | "low" | "unknown";

/** `classification` carries raw agency wording ("Class I" / "II" / "III"). */
export function classifyRiskLevel(classification: string): RiskLevel {
  const c = classification.trim().toLowerCase();
  if (/\bclass\s*iii\b/.test(c)) return "low";
  if (/\bclass\s*ii\b/.test(c)) return "moderate";
  if (/\bclass\s*i\b/.test(c)) return "high";
  return "unknown";
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  high: "High risk",
  moderate: "Moderate risk",
  low: "Low risk",
  unknown: "Risk level unknown",
};

export const RISK_LEVEL_DESCRIPTION: Record<RiskLevel, string> = {
  high: "Reasonable chance of serious harm (FDA Class I)",
  moderate: "Some chance of temporary or reversible harm (FDA Class II)",
  low: "Unlikely to cause harm (FDA Class III)",
  unknown: "Risk level not specified by the source.",
};

export type HazardType = "microbial" | "allergen" | "foreign_material" | "other";

export const HAZARD_TYPE_LABEL: Record<HazardType, string> = {
  microbial: "Bacteria / pathogen",
  allergen: "Undeclared allergen",
  foreign_material: "Foreign material",
  other: "Other hazard",
};

export type Audience = "human" | "pet" | "unknown";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  human: "Human food",
  pet: "Pet food",
  unknown: "Uncategorized",
};

// Big-nine allergens (SPEC.md §11 Step 3), duplicated intentionally from
// convex/lib/enrichment.ts's BIG_NINE_ALLERGENS: a fixed 9-item list, and
// frontend code shouldn't import backend modules across the tsconfig
// boundary (app/ vs convex/ have different lib/module targets).
export const BIG_NINE_ALLERGENS = [
  "milk",
  "eggs",
  "fish",
  "crustacean_shellfish",
  "tree_nuts",
  "peanuts",
  "wheat",
  "soy",
  "sesame",
] as const;

export function formatAllergenLabel(allergen: string): string {
  return allergen.replace(/_/g, " ");
}

export type RiskGroup = "infant" | "child" | "pregnant" | "older_adult" | "immunocompromised";

export const RISK_GROUP_LABEL: Record<RiskGroup, string> = {
  infant: "Infants",
  child: "Children",
  pregnant: "Pregnant people",
  older_adult: "Adults 65+",
  immunocompromised: "People with weakened immune systems",
};

export type AgeBand = "infant" | "child" | "adult" | "older_adult";

export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  infant: "Infant",
  child: "Kid",
  adult: "Adult",
  older_adult: "Adult 65+",
};

export type NotificationPreset = "recommended" | "everything" | "digest_only";

export const PRESET_LABEL: Record<NotificationPreset, string> = {
  recommended: "Recommended alerts",
  everything: "Everything, instantly",
  digest_only: "Digest only",
};

// Outbreak framing (SPEC.md §3, §11, Phase 4): "be aware right now" vs a
// recall's "check your stuff" — CDC investigations often precede or never
// become a recall, so they get their own, deliberately less-certain voice.
export type OutbreakStatus = "active" | "resolved";

export const OUTBREAK_STATUS_LABEL: Record<OutbreakStatus, string> = {
  active: "Be aware",
  resolved: "Resolved",
};

export const OUTBREAK_STATUS_DESCRIPTION: Record<OutbreakStatus, string> = {
  active: "Investigators haven't necessarily confirmed a specific product yet.",
  resolved: "CDC has closed this investigation.",
};

export type SourceCode = "fda" | "fsis" | "fda_rss" | "cdc";

export const SOURCE_LABEL: Record<SourceCode, string> = {
  fda: "FDA recall data",
  fsis: "USDA meat & poultry data",
  fda_rss: "FDA press release data",
  cdc: "CDC outbreak data",
};

// §8 feed personalization reason chips ("Your state," "Allergen: milk,"
// "Publix," "Pet," "Infant risk") + §7/§14 Phase 6 chain "possible" labeling.
// Mirrors convex/lib/matching.ts's MatchDimension — duplicated intentionally,
// same rationale as BIG_NINE_ALLERGENS above (app/ can't import convex/).
export type MatchDimension =
  | "state"
  | "brand"
  | "keyword"
  | "allergen"
  | "risk_group"
  | "pet"
  | "chain";

const RISK_GROUP_CHIP_LABEL: Record<string, string> = {
  infant: "Infant risk",
  child: "Child risk",
  pregnant: "Pregnancy risk",
  older_adult: "65+ risk",
  immunocompromised: "Immune risk",
};

/**
 * The reason-chip text for one matched dimension. `details` is the specific
 * matched value(s) (`matchResult.matchedDetails[dimension]`) when the
 * dimension names something concrete (allergen, risk group, chain, brand,
 * keyword) — state and pet are always generic.
 */
export function reasonChipLabel(dimension: MatchDimension, details?: string[]): string {
  switch (dimension) {
    case "state":
      return "Your state";
    case "pet":
      return "Pet";
    case "allergen":
      return details?.length ? `Allergen: ${details.map(formatAllergenLabel).join(", ")}` : "Allergen match";
    case "risk_group":
      return details?.length
        ? details.map((g) => RISK_GROUP_CHIP_LABEL[g] ?? g).join(", ")
        : "At-risk member";
    case "chain":
      // Deliberately just the store name(s), per §8's example ("Publix") —
      // the dashed/outline chip style itself signals 'possible' confidence;
      // the full "Possible match — ... verify" copy (§11) lives on Detail.
      return details?.length ? details.join(", ") : "Possible store match";
    case "brand":
      return details?.length ? details.join(", ") : "Your brand";
    case "keyword":
      return details?.length ? details.join(", ") : "Your keyword";
  }
}

/** §11: the plain-language explanation of a chain ("possible") match. */
export function chainMatchExplanation(chains: string[]): string {
  const stores = chains.join(", ");
  return `Possible match — the recall notice mentions ${stores}, but government data doesn't confirm specific stores. Check the official notice.`;
}
