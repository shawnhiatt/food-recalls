import { describe, expect, test } from "vitest";
import {
  decideRoute,
  matchRecall,
  severityOf,
  isFreshForNotification,
  householdRiskGroups,
  type MatchableAlert,
  type MatchablePrefs,
  type MatchResult,
} from "../convex/lib/matching";

// §7 matcher + §9 routing, pure. The stateful dispatch/dedupe is covered in
// notifications.test.ts; here we pin the rules.

const basePrefs = (overrides: Partial<MatchablePrefs> = {}): MatchablePrefs => ({
  states: ["NC"],
  brands: [],
  keywords: [],
  allergens: [],
  chains: [],
  categories: { humanFood: true, petFood: true, outbreaks: true },
  pets: [],
  members: [],
  ...overrides,
});

const baseAlert = (overrides: Partial<MatchableAlert> = {}): MatchableAlert => ({
  audience: "human",
  states: ["SC"],
  productDesc: "Generic snack bars",
  firm: "Acme Foods",
  allergens: [],
  riskGroups: [],
  ...overrides,
});

describe("matchRecall — dimensions (§7)", () => {
  test("state match on intersection", () => {
    const r = matchRecall(baseAlert({ states: ["NC", "VA"] }), basePrefs());
    expect(r.matched).toBe(true);
    expect(r.matchedOn).toContain("state");
  });

  test("nationwide alert matches any household", () => {
    const r = matchRecall(baseAlert({ states: ["US"] }), basePrefs({ states: ["TX"] }));
    expect(r.matchedOn).toContain("state");
  });

  test("brand and keyword are case-insensitive substrings over desc + firm", () => {
    const r = matchRecall(
      baseAlert({ productDesc: "Organic SPINACH clamshell", firm: "Green Farm" }),
      basePrefs({ states: [], brands: ["green farm"], keywords: ["spinach"] }),
    );
    expect(r.matchedOn).toEqual(expect.arrayContaining(["brand", "keyword"]));
  });

  test("allergen match sets hasAllergenMatch", () => {
    const r = matchRecall(
      baseAlert({ states: [], allergens: ["milk", "soy"] }),
      basePrefs({ states: [], allergens: ["milk"] }),
    );
    expect(r.hasAllergenMatch).toBe(true);
    expect(r.matchedOn).toContain("allergen");
  });

  test("risk-group match derives household groups from members", () => {
    const prefs = basePrefs({
      states: [],
      members: [
        { ageBand: "adult", immunocompromised: true },
        { ageBand: "infant" },
      ],
    });
    expect([...householdRiskGroups(prefs)].sort()).toEqual([
      "immunocompromised",
      "infant",
    ]);
    const r = matchRecall(baseAlert({ states: [], riskGroups: ["infant"] }), prefs);
    expect(r.hasRiskGroupMatch).toBe(true);
    expect(r.matchedOn).toContain("risk_group");
  });

  test("pet audience matches only when the household has pets", () => {
    const alert = baseAlert({ audience: "pet", states: [], productDesc: "dog kibble" });
    expect(matchRecall(alert, basePrefs({ states: [], pets: [] })).matched).toBe(false);
    const withPet = matchRecall(alert, basePrefs({ states: [], pets: ["dog"] }));
    expect(withPet.matchedOn).toContain("pet");
  });

  test("no matching dimension → no match", () => {
    const r = matchRecall(baseAlert({ states: ["CA"] }), basePrefs({ states: ["NC"] }));
    expect(r.matched).toBe(false);
    expect(r.matchedOn).toEqual([]);
  });

  test("matchedDetails names the specific allergen/brand/keyword/risk-group that matched", () => {
    const r = matchRecall(
      baseAlert({
        states: [],
        productDesc: "Organic SPINACH clamshell",
        firm: "Green Farm",
        allergens: ["milk", "soy"],
        riskGroups: ["infant"],
      }),
      basePrefs({
        states: [],
        brands: ["green farm"],
        keywords: ["spinach"],
        allergens: ["milk"],
        members: [{ ageBand: "infant" }],
      }),
    );
    expect(r.matchedDetails.brand).toEqual(["green farm"]);
    expect(r.matchedDetails.keyword).toEqual(["spinach"]);
    expect(r.matchedDetails.allergen).toEqual(["milk"]);
    expect(r.matchedDetails.risk_group).toEqual(["infant"]);
  });
});

// Chain (fuzzy retailer) matching — Phase 6, §7: "fuzzy/substring match
// against distribution + press text, flagged confidence: 'possible'.
// Chain-only matches never notify instantly."
describe("matchRecall — chain matching (§7, Phase 6)", () => {
  test("distribution text containing a household's store is a chain match at 'possible' confidence", () => {
    const r = matchRecall(
      baseAlert({
        states: [],
        distribution: "Distributed to Publix and Kroger stores in the Southeast.",
      }),
      basePrefs({ states: [], chains: ["Publix"] }),
    );
    expect(r.matched).toBe(true);
    expect(r.matchedOn).toContain("chain");
    expect(r.confidence.chain).toBe("possible");
    expect(r.matchedDetails.chain).toEqual(["Publix"]);
  });

  test("chain-only match sets overallConfidence to 'possible' (never instant, §9)", () => {
    const r = matchRecall(
      baseAlert({ states: [], distribution: "Sold at Publix locations." }),
      basePrefs({ states: [], chains: ["Publix"] }),
    );
    expect(r.matchedOn).toEqual(["chain"]);
    expect(r.overallConfidence).toBe("possible");
  });

  test("chain + state match keeps overallConfidence 'high' — not chain-only", () => {
    const r = matchRecall(
      baseAlert({ states: ["NC"], distribution: "Sold at Publix locations." }),
      basePrefs({ states: ["NC"], chains: ["Publix"] }),
    );
    expect(r.matchedOn).toEqual(expect.arrayContaining(["state", "chain"]));
    expect(r.overallConfidence).toBe("high");
  });

  test("no distribution text on the alert (e.g. outbreaks) never matches on chain", () => {
    const r = matchRecall(
      baseAlert({ states: [], distribution: undefined }),
      basePrefs({ states: [], chains: ["Publix"] }),
    );
    expect(r.matchedOn).not.toContain("chain");
  });

  test("household with no chains preference never chain-matches", () => {
    const r = matchRecall(
      baseAlert({ states: [], distribution: "Sold at Publix locations." }),
      basePrefs({ states: [], chains: [] }),
    );
    expect(r.matched).toBe(false);
  });
});

// Outbreak-shaped alerts (Phase 4, §14: "risk-group matching test passes").
// MatchableAlert is already generic across recalls/outbreaks — outbreaks
// just have no firm/allergens, and carry their "keyword" surface in
// suspectedFood rather than productDesc (§7: "+ suspectedFood for outbreaks").
const baseOutbreak = (overrides: Partial<MatchableAlert> = {}): MatchableAlert => ({
  audience: "human",
  states: [],
  productDesc: "",
  firm: "",
  allergens: [],
  riskGroups: [],
  suspectedFood: "Frozen Blueberries",
  ...overrides,
});

describe("matchRecall — outbreak-shaped alerts (§7, Phase 4)", () => {
  test("state match works the same as for recalls", () => {
    const r = matchRecall(baseOutbreak({ states: ["FL", "GA"] }), basePrefs({ states: ["FL"] }));
    expect(r.matched).toBe(true);
    expect(r.matchedOn).toContain("state");
  });

  test("nationwide outbreak matches any household", () => {
    const r = matchRecall(baseOutbreak({ states: ["US"] }), basePrefs({ states: ["TX"] }));
    expect(r.matchedOn).toContain("state");
  });

  test("keyword match against suspectedFood (outbreaks have no productDesc)", () => {
    const r = matchRecall(
      baseOutbreak({ suspectedFood: "Powdered Infant Formula" }),
      basePrefs({ states: [], keywords: ["infant formula"] }),
    );
    expect(r.matchedOn).toContain("keyword");
  });

  test("risk-group match works the same as for recalls (thin outbreak data still matches)", () => {
    const prefs = basePrefs({
      states: [],
      members: [{ ageBand: "older_adult" }],
    });
    const r = matchRecall(
      baseOutbreak({ riskGroups: ["older_adult", "immunocompromised"] }),
      prefs,
    );
    expect(r.hasRiskGroupMatch).toBe(true);
    expect(r.matchedOn).toContain("risk_group");
  });

  test("category gate still applies: outbreaks category disabled → inert", () => {
    const r = matchRecall(
      baseOutbreak({ states: ["NC"] }),
      basePrefs({ categories: { humanFood: false, petFood: true, outbreaks: true } }),
    );
    // Outbreaks are always audience 'human' — gated by humanFood like any
    // other human-food alert (the outbreaks category toggle in §7 governs
    // whether outbreak-type alerts are matched at all upstream of the
    // matcher; matchRecall itself only knows audience-based gating).
    expect(r.categoryEnabled).toBe(false);
    expect(r.matched).toBe(false);
  });

  test("no matching dimension on a thin outbreak → no match, no crash", () => {
    const r = matchRecall(baseOutbreak({ suspectedFood: "Moringa Capsules" }), basePrefs({ states: [] }));
    expect(r.matched).toBe(false);
    expect(r.matchedOn).toEqual([]);
  });
});

describe("matchRecall — category gate is absolute (§7, §17.6)", () => {
  test("pet-food recall is inert when petFood is disabled — even on a strong match", () => {
    const r = matchRecall(
      baseAlert({ audience: "pet", states: ["NC"], allergens: ["milk"], riskGroups: ["infant"] }),
      basePrefs({ allergens: ["milk"], pets: ["dog"], categories: { humanFood: true, petFood: false, outbreaks: true } }),
    );
    expect(r.categoryEnabled).toBe(false);
    expect(r.matched).toBe(false);
    expect(r.matchedOn).toEqual([]);
  });

  test("human-food recall is inert when humanFood is disabled", () => {
    const r = matchRecall(
      baseAlert({ audience: "human", states: ["NC"] }),
      basePrefs({ categories: { humanFood: false, petFood: true, outbreaks: true } }),
    );
    expect(r.categoryEnabled).toBe(false);
    expect(r.matched).toBe(false);
  });

  test("unknown-audience recall is gated by humanFood (unknowns display under human)", () => {
    const r = matchRecall(
      baseAlert({ audience: "unknown", states: ["NC"] }),
      basePrefs({ categories: { humanFood: false, petFood: true, outbreaks: true } }),
    );
    expect(r.categoryEnabled).toBe(false);
  });
});

describe("severityOf", () => {
  test("maps agency classification strings", () => {
    expect(severityOf("Class I")).toBe("class1");
    expect(severityOf("Class II")).toBe("class2");
    expect(severityOf("Class III")).toBe("class3");
    expect(severityOf("")).toBe("unknown");
  });
});

describe("isFreshForNotification — backfill guard", () => {
  const now = Date.UTC(2026, 6, 11); // 2026-07-11
  test("recent recall is fresh", () => {
    expect(isFreshForNotification("2026-07-01", now)).toBe(true);
  });
  test("old recall (historical backfill) is not fresh", () => {
    expect(isFreshForNotification("2025-01-01", now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9 decision matrix. Every routing row has at least one case here; the
// stateful matrix rows (dedupe, closure, pref-change) are in
// notifications.test.ts.
// ---------------------------------------------------------------------------

const matched = (over: Partial<MatchResult> = {}): MatchResult => ({
  matched: true,
  categoryEnabled: true,
  matchedOn: ["state"],
  confidence: { state: "high" },
  matchedDetails: {},
  hasAllergenMatch: false,
  hasRiskGroupMatch: false,
  overallConfidence: "high",
  ...over,
});

describe("decideRoute — §9 matrix routing", () => {
  test("no match → none (national feed only)", () => {
    const r = decideRoute({
      match: { ...matched(), matched: false },
      severity: "class1",
      threshold: "everything",
    });
    expect(r.route).toBe("none");
  });

  test("hard floor: Class I + allergen → instant regardless of threshold", () => {
    const r = decideRoute({
      match: matched({ hasAllergenMatch: true }),
      severity: "class1",
      threshold: "class1_only", // digest-only preset still can't suppress the floor
    });
    expect(r).toEqual({ route: "instant", hardFloor: true });
  });

  test("hard floor: Class I + risk group → instant regardless of threshold", () => {
    const r = decideRoute({
      match: matched({ hasRiskGroupMatch: true }),
      severity: "class1",
      threshold: "class1_only",
    });
    expect(r).toEqual({ route: "instant", hardFloor: true });
  });

  test("Recommended (class1_plus_allergen): Class I state-only → instant", () => {
    const r = decideRoute({
      match: matched(),
      severity: "class1",
      threshold: "class1_plus_allergen",
    });
    expect(r.route).toBe("instant");
    expect(r.hardFloor).toBe(false);
  });

  test("Recommended: Class II + allergen → instant (the '+ allergen' half)", () => {
    const r = decideRoute({
      match: matched({ hasAllergenMatch: true }),
      severity: "class2",
      threshold: "class1_plus_allergen",
    });
    expect(r.route).toBe("instant");
  });

  test("Recommended: Class II state-only → digest (below threshold)", () => {
    const r = decideRoute({
      match: matched(),
      severity: "class2",
      threshold: "class1_plus_allergen",
    });
    expect(r.route).toBe("digest");
  });

  test("class1_only: Class II → digest", () => {
    const r = decideRoute({
      match: matched(),
      severity: "class2",
      threshold: "class1_only",
    });
    expect(r.route).toBe("digest");
  });

  test("everything: any matched alert → instant", () => {
    const r = decideRoute({
      match: matched(),
      severity: "class3",
      threshold: "everything",
    });
    expect(r.route).toBe("instant");
  });

  test("chain-only 'possible' match never goes instant → digest", () => {
    const r = decideRoute({
      match: matched({
        matchedOn: ["chain"],
        confidence: { chain: "possible" },
        overallConfidence: "possible",
      }),
      severity: "class1",
      threshold: "everything",
    });
    expect(r.route).toBe("digest");
  });
});
