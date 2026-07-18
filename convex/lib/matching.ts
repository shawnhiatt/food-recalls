// Matching engine (SPEC.md §7) — pure so it can be exhaustively fixture-tested.
// For each new or materially updated alert, match against a household's
// preferences. A match fires on ANY enabled dimension (OR logic), gated by the
// category toggles. The matcher emits ONE structured payload that drives feed
// ranking, reason chips, notification copy, and instant-vs-digest routing (§7).
//
// The category gate is ABSOLUTE (§7, §17.6): a disabled category is never
// evaluated, and no rule — including the notification hard floor — overrides it.

export type MatchDimension =
  | "state"
  | "brand"
  | "keyword"
  | "allergen"
  | "risk_group"
  | "pet"
  | "chain"; // Phase 6 (fuzzy retailer); always 'possible' confidence

export type Confidence = "high" | "possible";

export type MatchResult = {
  /** True when at least one enabled dimension matched within an enabled category. */
  matched: boolean;
  /**
   * False when the alert's category (human/pet food) is disabled in prefs. When
   * false, `matched` is always false and no dimension was even evaluated — the
   * caller must not resurrect it via the hard floor.
   */
  categoryEnabled: boolean;
  matchedOn: MatchDimension[];
  /** Per-dimension confidence, for reason chips and 'possible' labeling. */
  confidence: Partial<Record<MatchDimension, Confidence>>;
  /**
   * The specific values that matched per dimension — e.g. `allergen: ["milk"]`,
   * `chain: ["Publix"]`, `risk_group: ["infant"]` — so reason chips can read
   * "Allergen: milk" / "Publix" (§8) instead of a generic dimension label.
   */
  matchedDetails: Partial<Record<MatchDimension, string[]>>;
  /** Allergen match present — feeds the §9 hard floor and threshold logic. */
  hasAllergenMatch: boolean;
  /** Risk-group match present — feeds the §9 hard floor. */
  hasRiskGroupMatch: boolean;
  /**
   * 'possible' only when EVERY matched dimension is 'possible' (i.e. a
   * chain-only match). Chain-only matches never notify instantly (§7, §9).
   */
  overallConfidence: Confidence;
};

// Shape the matcher needs from a recall document (a subset of the recalls table).
export type MatchableAlert = {
  audience: "human" | "pet" | "unknown";
  states: string[];
  productDesc: string;
  firm: string;
  allergens: string[];
  riskGroups: string[];
  /** Outbreaks only (Phase 4); recalls pass undefined. */
  suspectedFood?: string;
  /** Recalls only (Phase 6 chain matching); raw free text, outbreaks pass undefined. */
  distribution?: string;
};

/**
 * Adapt an outbreak into the matcher's generic `MatchableAlert` (§7 Phase 4).
 * Outbreaks present as human-audience alerts (so the humanFood category gate
 * applies — the separate `categories.outbreaks` toggle is checked upstream in
 * the dispatch layer) with no firm/allergens/distribution; their `suspectedFood`
 * feeds brand/keyword text and their `riskGroups` feed the hard floor.
 */
export type OutbreakMatchInput = {
  states: string[];
  suspectedFood?: string;
  riskGroups: string[];
};

export function outbreakToMatchable(o: OutbreakMatchInput): MatchableAlert {
  return {
    audience: "human",
    states: o.states,
    productDesc: "",
    firm: "",
    allergens: [],
    riskGroups: o.riskGroups,
    suspectedFood: o.suspectedFood,
    distribution: undefined,
  };
}

/**
 * §4: "active outbreaks are Class I equivalent for alerting." Severity only
 * ever drives dispatch for an active outbreak (resolved ones never notify as
 * new), so this is a constant rather than a status switch.
 */
export const OUTBREAK_ALERT_SEVERITY: Severity = "class1";

// Shape the matcher needs from householdPreferences.
export type MatchablePrefs = {
  states: string[];
  brands: string[];
  keywords: string[];
  allergens: string[];
  /** Fuzzy-match retailers (Phase 6) — always 'possible' confidence, per §7. */
  chains: string[];
  categories: { humanFood: boolean; petFood: boolean; outbreaks: boolean };
  pets: Array<"dog" | "cat" | "other">;
  members: Array<{
    ageBand: "infant" | "child" | "adult" | "older_adult";
    pregnant?: boolean;
    immunocompromised?: boolean;
  }>;
};

/**
 * The at-risk populations a household embodies, derived from its members'
 * age bands and health flags. Intersected with an alert's `riskGroups` (§7).
 */
export function householdRiskGroups(prefs: MatchablePrefs): Set<string> {
  const groups = new Set<string>();
  for (const member of prefs.members) {
    if (member.ageBand === "infant") groups.add("infant");
    if (member.ageBand === "child") groups.add("child");
    if (member.ageBand === "older_adult") groups.add("older_adult");
    if (member.pregnant) groups.add("pregnant");
    if (member.immunocompromised) groups.add("immunocompromised");
  }
  return groups;
}

/** Which household category toggle gates this alert (§7 category gate). */
function categoryEnabledFor(
  alert: MatchableAlert,
  prefs: MatchablePrefs,
): boolean {
  // Pet-audience alerts are gated by petFood; human AND unknown by humanFood
  // (unknowns display under human, §4).
  if (alert.audience === "pet") return prefs.categories.petFood;
  return prefs.categories.humanFood;
}

function intersects(a: string[], b: string[] | Set<string>): boolean {
  const set = b instanceof Set ? b : new Set(b);
  return a.some((x) => set.has(x));
}

/** The actual values present in both — for reason chips ("Allergen: milk"). */
function intersectValues(a: string[], b: string[] | Set<string>): string[] {
  const set = b instanceof Set ? b : new Set(b);
  return a.filter((x) => set.has(x));
}

/** Which needles (original casing) appear in haystack — for reason chips. */
function textContainsWhich(haystack: string, needles: string[]): string[] {
  const hay = haystack.toLowerCase();
  return needles.filter((n) => {
    const term = n.trim().toLowerCase();
    return term.length > 0 && hay.includes(term);
  });
}

/**
 * §7 matcher. Returns the structured match payload. When the alert's category
 * is disabled the result is inert (`matched:false`, `categoryEnabled:false`)
 * before any dimension is evaluated.
 */
export function matchRecall(
  alert: MatchableAlert,
  prefs: MatchablePrefs,
): MatchResult {
  const inert: MatchResult = {
    matched: false,
    categoryEnabled: false,
    matchedOn: [],
    confidence: {},
    matchedDetails: {},
    hasAllergenMatch: false,
    hasRiskGroupMatch: false,
    overallConfidence: "high",
  };

  if (!categoryEnabledFor(alert, prefs)) return inert;

  const matchedOn: MatchDimension[] = [];
  const confidence: Partial<Record<MatchDimension, Confidence>> = {};
  const matchedDetails: Partial<Record<MatchDimension, string[]>> = {};

  // State: household state ∩ alert states, or a nationwide alert ('US').
  if (
    alert.states.includes("US") ||
    intersects(prefs.states, alert.states)
  ) {
    matchedOn.push("state");
    confidence.state = "high";
  }

  // Brand / keyword: case-insensitive substring over productDesc + firm
  // (+ suspectedFood for outbreaks, §7).
  const text = `${alert.productDesc} ${alert.firm} ${alert.suspectedFood ?? ""}`;
  const matchedBrands = textContainsWhich(text, prefs.brands);
  if (matchedBrands.length > 0) {
    matchedOn.push("brand");
    confidence.brand = "high";
    matchedDetails.brand = matchedBrands;
  }
  const matchedKeywords = textContainsWhich(text, prefs.keywords);
  if (matchedKeywords.length > 0) {
    matchedOn.push("keyword");
    confidence.keyword = "high";
    matchedDetails.keyword = matchedKeywords;
  }

  // Allergen: prefs ∩ alert allergens. High confidence (§7).
  const matchedAllergens = intersectValues(prefs.allergens, alert.allergens);
  const hasAllergenMatch = matchedAllergens.length > 0;
  if (hasAllergenMatch) {
    matchedOn.push("allergen");
    confidence.allergen = "high";
    matchedDetails.allergen = matchedAllergens;
  }

  // Risk group: household risk flags ∩ alert riskGroups.
  const matchedRiskGroups = intersectValues(
    alert.riskGroups,
    householdRiskGroups(prefs),
  );
  const hasRiskGroupMatch = matchedRiskGroups.length > 0;
  if (hasRiskGroupMatch) {
    matchedOn.push("risk_group");
    confidence.risk_group = "high";
    matchedDetails.risk_group = matchedRiskGroups;
  }

  // Pet: pet-audience alert and the household has pets (category already
  // confirmed petFood-enabled above).
  if (alert.audience === "pet" && prefs.pets.length > 0) {
    matchedOn.push("pet");
    confidence.pet = "high";
  }

  // Chain (Phase 6): fuzzy/substring match of a household's favorite stores
  // against the recall's raw distribution text. Outbreaks carry no
  // `distribution` field, so this is a no-op for them. ALWAYS 'possible' —
  // government data never confirms specific stores (§3, §7) — so a
  // chain-only match never notifies instantly regardless of how many stores
  // match.
  const matchedChains = textContainsWhich(alert.distribution ?? "", prefs.chains);
  if (matchedChains.length > 0) {
    matchedOn.push("chain");
    confidence.chain = "possible";
    matchedDetails.chain = matchedChains;
  }

  const matched = matchedOn.length > 0;
  // overallConfidence is 'possible' only when every matched dimension is
  // 'possible' — i.e. chain-only.
  const overallConfidence: Confidence =
    matched && matchedOn.every((d) => confidence[d] === "possible")
      ? "possible"
      : "high";

  return {
    matched,
    categoryEnabled: true,
    matchedOn,
    confidence,
    matchedDetails,
    hasAllergenMatch,
    hasRiskGroupMatch,
    overallConfidence,
  };
}

// ---------------------------------------------------------------------------
// Severity (§12 severity system). Derived from the raw agency `classification`
// string. Kept here (not lib/copy.ts, which is frontend-only) so the matcher
// and notification router share one definition.
// ---------------------------------------------------------------------------

export type Severity = "class1" | "class2" | "class3" | "unknown";

/**
 * A freshly-ingested recall only notifies if it was published recently. This
 * guards against the historical backfill (§13 Phase 0: ~29k records) blasting
 * the household with thousands of old alerts the first time dispatch runs, and
 * against a re-run backfill doing the same. Older matched recalls still surface
 * in the feed's household section (a re-rank, not a notification) — consistent
 * with "preference changes re-rank but never notify" (§7, §17.11). Applies to
 * NEW alerts only; material updates/closures are live changes and notify per
 * the §9 matrix regardless of the original recall date.
 */
export const NOTIFY_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO dates (YYYY-MM-DD) sort lexicographically, so a string compare works. */
export function isFreshForNotification(recallDate: string, now: number): boolean {
  const cutoff = new Date(now - NOTIFY_WINDOW_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return recallDate >= cutoff;
}

export function severityOf(classification: string): Severity {
  const c = (classification ?? "").trim().toLowerCase();
  if (/\bclass\s*iii\b/.test(c)) return "class3";
  if (/\bclass\s*ii\b/.test(c)) return "class2";
  if (/\bclass\s*i\b/.test(c)) return "class1";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Notification routing — the §9 decision matrix, pure. Given a match, the
// alert severity, and the member's urgency threshold, decide whether a NEW
// alert or a materially-updated revision goes instant, into the digest, or
// nowhere. Statefulness (dedupe, closures, pref-change suppression) lives in
// the dispatch layer; this function encodes only the routing rules.
// ---------------------------------------------------------------------------

export type Route = "instant" | "digest" | "none";
export type UrgencyThreshold =
  | "class1_only"
  | "class1_plus_allergen"
  | "everything";

export type RouteDecision = {
  route: Route;
  /** True when the §9 hard floor forced instant regardless of threshold. */
  hardFloor: boolean;
};

/**
 * §9 routing for a new alert or a not-yet-sent revision:
 *  - No match (incl. disabled category) → none (national feed only).
 *  - Hard floor: Class I + allergen match, or Class I + risk-group match →
 *    always instant, regardless of threshold — within enabled categories only
 *    (guaranteed because `match.matched` is false for disabled categories).
 *  - Chain-only ('possible') → never instant; digest, labeled "possible".
 *  - Otherwise the member's threshold decides instant vs. digest; anything
 *    matched but below the bar rolls into the digest.
 */
export function decideRoute(params: {
  match: MatchResult;
  severity: Severity;
  threshold: UrgencyThreshold;
}): RouteDecision {
  const { match, severity, threshold } = params;

  if (!match.matched) return { route: "none", hardFloor: false };

  const hardFloor =
    severity === "class1" &&
    (match.hasAllergenMatch || match.hasRiskGroupMatch);
  if (hardFloor) return { route: "instant", hardFloor: true };

  // Chain-only possible matches never interrupt instantly (§7).
  if (match.overallConfidence === "possible") {
    return { route: "digest", hardFloor: false };
  }

  const meetsThreshold =
    threshold === "everything" ||
    (threshold === "class1_only" && severity === "class1") ||
    (threshold === "class1_plus_allergen" &&
      (severity === "class1" || match.hasAllergenMatch));

  return { route: meetsThreshold ? "instant" : "digest", hardFloor: false };
}
