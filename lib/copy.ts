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

export type SourceCode = "fda" | "fsis" | "fda_rss" | "cdc";

export const SOURCE_LABEL: Record<SourceCode, string> = {
  fda: "FDA recall data",
  fsis: "USDA meat & poultry data",
  fda_rss: "FDA press release data",
  cdc: "CDC outbreak data",
};
