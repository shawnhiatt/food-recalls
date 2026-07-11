// Enrichment tagging pass (SPEC.md §4). Deliberate error bias:
//  - allergen tagging biases toward FALSE POSITIVES (an extra alert beats a
//    missed peanut recall) — synonym lists are generous;
//  - pet-food classification biases toward FALSE NEGATIVES (mislabeled pet food
//    shows to everyone rather than disappearing) — pet requires strong signals.
// Raw records are always kept alongside tags so tags stay correctable.

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

export type Allergen = (typeof BIG_NINE_ALLERGENS)[number];

const ALLERGEN_PATTERNS: Record<Allergen, RegExp> = {
  milk: /\bmilk\b|\bdairy\b|\bwhey\b|\bcasein(?:ate)?\b|\bbutter\b|\bcream\b|\bcheese\b|\blactose\b|\byogurt\b|\bghee\b/i,
  eggs: /\begg(?:s)?\b|\balbumin\b|\bovalbumin\b|\bmayonnaise\b/i,
  fish: /\bfish\b|\banchov(?:y|ies)\b|\bcod\b|\bsalmon\b|\btuna\b|\btilapia\b|\bpollock\b|\bhalibut\b|\bswordfish\b|\bsurimi\b/i,
  crustacean_shellfish:
    /\bshellfish\b|\bshrimp\b|\bcrab\b|\blobster\b|\bprawn(?:s)?\b|\bcrawfish\b|\bcrayfish\b|\bkrill\b/i,
  tree_nuts:
    /\btree ?nut(?:s)?\b|\balmond(?:s)?\b|\bcashew(?:s)?\b|\bwalnut(?:s)?\b|\bpecan(?:s)?\b|\bpistachio(?:s)?\b|\bhazelnut(?:s)?\b|\bmacadamia(?:s)?\b|\bbrazil nut(?:s)?\b|\bpine nut(?:s)?\b|\bpraline(?:s)?\b|\bcoconut\b/i,
  peanuts: /\bpeanut(?:s)?\b|\bgroundnut(?:s)?\b|\barachis\b/i,
  wheat: /\bwheat\b|\bgluten\b|\bfarina\b|\bsemolina\b|\bdurum\b|\bspelt\b|\bmalt\b/i,
  soy: /\bsoy(?:a|bean(?:s)?)?\b|\bedamame\b|\btofu\b|\btempeh\b|\bmiso\b|\blecithin\b/i,
  sesame: /\bsesame\b|\btahini\b|\bbenne\b/i,
};

/** Scan reason/product text for FDA big-nine allergens. Generous by design. */
export function extractAllergens(text: string): Allergen[] {
  if (!text) return [];
  return BIG_NINE_ALLERGENS.filter((a) => ALLERGEN_PATTERNS[a].test(text));
}

export type Audience = "human" | "pet" | "unknown";

const PET_STRONG_RE =
  /\bpet food\b|\bdog(?:s)?\b|\bcat(?:s)?\b|\bcanine\b|\bfeline\b|\bpupp(?:y|ies)\b|\bkitten(?:s)?\b|\bkibble\b|\bpet treat(?:s)?\b|\bchew(?:s)? for (?:dogs|cats|pets)\b|\bbird ?seed\b|\baquarium\b|\bfor pets\b/i;

/**
 * Human vs. pet food. Pet requires a strong signal in the product description
 * or firm name (false-negative bias); unknown only when there is no text at all.
 * Unknowns display under human (§4).
 */
export function classifyAudience(productDesc: string, firm: string): Audience {
  const desc = productDesc ?? "";
  const firmName = firm ?? "";
  if (!desc.trim() && !firmName.trim()) return "unknown";
  if (PET_STRONG_RE.test(desc)) return "pet";
  if (/\bpet\b/i.test(firmName) && /\bfood|treat|chew|kibble\b/i.test(desc)) {
    return "pet";
  }
  return "human";
}

export type HazardType = "microbial" | "allergen" | "foreign_material" | "other";

const MICROBIAL_RE =
  /\blisteria\b|\bsalmonella\b|\be\.? ?coli\b|\bescherichia\b|\bbotuli[a-z]*\b|\bclostridium\b|\bhepatitis\b|\bnorovirus\b|\bcyclospora\b|\bcampylobacter\b|\bcronobacter\b|\bstaphylococc[a-z]*\b|\bshigella\b|\bvibrio\b|\bmold\b|\bbacteri[a-z]*\b|\bpathogen[a-z]*\b|\bmicrobial\b|\baflatoxin\b/i;

const FOREIGN_MATERIAL_RE =
  /\bforeign (?:material|matter|object)s?\b|\bextraneous material(?:s)?\b|\bmetal\b|\bglass\b|\bplastic\b|\bwood\b|\brubber\b|\brock(?:s)?\b|\bstone(?:s)?\b|\bbone fragment(?:s)?\b/i;

const ALLERGEN_HAZARD_RE = /\bundeclared\b|\ballergen(?:s)?\b|\bmislabel[a-z]*\b|\bmisbrand[a-z]*\b/i;

/**
 * Hazard classification from reason text. Precedence: microbial >
 * foreign material > allergen > other — a "Listeria in undeclared-milk product"
 * reason is a pathogen problem first.
 */
export function classifyHazard(reasonText: string, allergens: string[]): HazardType {
  const text = reasonText ?? "";
  if (MICROBIAL_RE.test(text)) return "microbial";
  if (FOREIGN_MATERIAL_RE.test(text)) return "foreign_material";
  if (ALLERGEN_HAZARD_RE.test(text) || allergens.length > 0) return "allergen";
  return "other";
}

export const RISK_GROUPS = [
  "infant",
  "child",
  "pregnant",
  "older_adult",
  "immunocompromised",
] as const;

export type RiskGroup = (typeof RISK_GROUPS)[number];

const RISK_GROUP_PATTERNS: Record<RiskGroup, RegExp> = {
  infant: /\binfant(?:s)?\b|\bnewborn(?:s)?\b|\bbab(?:y|ies)\b/i,
  child: /\bchild(?:ren)?\b|\byoung children\b|\bkids\b/i,
  pregnant: /\bpregnan[a-z]*\b/i,
  older_adult: /\belderly\b|\bolder adults?\b|\bseniors?\b|\baged 65\b|\b65 (?:and|or) (?:older|over)\b/i,
  immunocompromised:
    /\bimmunocompromised\b|\bimmuno-?compromised\b|\bweakened immune\b|\bcompromised immune\b|\bimmune[- ]?suppressed\b/i,
};

/** Extract at-risk populations from "who's at risk" style text (§4 step 4). */
export function extractRiskGroups(text: string): RiskGroup[] {
  if (!text) return [];
  return RISK_GROUPS.filter((g) => RISK_GROUP_PATTERNS[g].test(text));
}

/** Extract UPC/lot-like digit codes from free code text (spaces/dashes allowed). */
export function extractProductCodes(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  // Digit runs (possibly space/dash separated) that normalize to 8–14 digits:
  // covers UPC-A (12), EAN-13, GTIN-14, and shorter UPC-E forms.
  for (const match of text.matchAll(/\b\d[\d\s-]{6,20}\d\b/g)) {
    const digits = match[0].replace(/[\s-]/g, "");
    if (digits.length >= 8 && digits.length <= 14) found.add(digits);
  }
  return [...found].sort();
}
