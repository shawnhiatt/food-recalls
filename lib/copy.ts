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

/** Short scope names: what a source covers, so a gap says what's missing. */
export const SOURCE_LABEL: Record<SourceCode, string> = {
  fda: "FDA recalls",
  fsis: "USDA meat & poultry",
  fda_rss: "FDA press releases",
  cdc: "CDC outbreaks",
};

const SOURCE_ORDER: SourceCode[] = ["fda", "fda_rss", "fsis", "cdc"];

/** "earlier today" / "Tuesday" / "Nov 3" / "July" / "July 2025" — coarser the older it is, so gaps group. */
function sinceLabel(lastSuccessAt: number, now: number): string {
  const then = new Date(lastSuccessAt);
  const today = new Date(now);
  const days = (now - lastSuccessAt) / 86_400_000;
  if (then.toDateString() === today.toDateString()) return "earlier today";
  if (days < 6) return then.toLocaleDateString("en-US", { weekday: "long" });
  if (days < 30) return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (then.getFullYear() === today.getFullYear()) return then.toLocaleDateString("en-US", { month: "long" });
  return then.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Coverage lines for the source-health banner (SPEC.md §10, UX-01): which
 * sources are behind and since when, one line per shared "since", oldest
 * first. Coverage only — whether the household has matches is a separate
 * claim the banner makes on its own (and never when signed out).
 */
export function coverageGapLines(
  sources: { source: SourceCode; state: "current" | "delayed" | "unavailable"; lastSuccessAt: number }[],
  now: number,
): string[] {
  const behind = sources
    .filter((s) => s.state !== "current")
    .sort(
      (a, b) =>
        a.lastSuccessAt - b.lastSuccessAt || SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
    );
  const groups = new Map<string, string[]>();
  for (const s of behind) {
    const key = s.lastSuccessAt === 0 ? "" : sinceLabel(s.lastSuccessAt, now);
    groups.set(key, [...(groups.get(key) ?? []), SOURCE_LABEL[s.source]]);
  }
  return [...groups].map(([since, names]) => {
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return since === "" ? `${who}: no data yet.` : `${who}: no updates since ${since}.`;
  });
}

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

// §11 Scanner copy (Phase 7): "No known recall" — never "safe" (§3) — plus
// the same-manufacturer soft-match framing.
export const NO_KNOWN_RECALL_COPY =
  "No known recall for this barcode. Recalls don't always include barcodes, so also check brand and lot number.";

export function sameManufacturerExplanation(firms: string[]): string {
  const unique = [...new Set(firms)];
  const who = unique.length === 1 ? unique[0] : `${unique.length} companies`;
  return `Possible match — this isn't the exact recalled product, but ${who} has another active recall right now. Worth a look.`;
}

// §10 scanner archived rung: this exact product had a recall that has since
// been resolved. Deliberately reassuring, not alarming — it's history, not an
// active warning — while still nudging a check of older stock.
export function archivedRecallExplanation(year?: string): string {
  const when = year ? ` back in ${year}` : "";
  return `This product had a recall${when} that's since been resolved — not an active warning. If you've had it a long time, check the lot details on the notice to be sure.`;
}
