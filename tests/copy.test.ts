import { describe, expect, test } from "vitest";
import {
  classifyRiskLevel,
  coverageGapLines,
  firmNames,
  formatAllergenLabel,
  plainTimelineSummary,
  reasonChipLabel,
  recallSourceAttribution,
} from "../lib/copy";

// Plain-language copy rules (SPEC.md §11) — classification is raw agency
// wording ("Class I" / "II" / "III"); guards against the "Class I" substring
// trap inside "Class II"/"Class III".
describe("classifyRiskLevel", () => {
  test("maps raw classification wording to a risk level", () => {
    expect(classifyRiskLevel("Class I")).toBe("high");
    expect(classifyRiskLevel("Class II")).toBe("moderate");
    expect(classifyRiskLevel("Class III")).toBe("low");
  });

  test("is case-insensitive and tolerates extra whitespace", () => {
    expect(classifyRiskLevel("  class i  ")).toBe("high");
    expect(classifyRiskLevel("CLASS III")).toBe("low");
  });

  test("does not mistake Class II/III for a Class I substring match", () => {
    expect(classifyRiskLevel("Class II")).not.toBe("high");
    expect(classifyRiskLevel("Class III")).not.toBe("high");
    expect(classifyRiskLevel("Class III")).not.toBe("moderate");
  });

  test("unrecognized or missing classification is unknown", () => {
    expect(classifyRiskLevel("")).toBe("unknown");
    expect(classifyRiskLevel("Not Yet Classified")).toBe("unknown");
  });
});

describe("formatAllergenLabel", () => {
  test("replaces underscores with spaces", () => {
    expect(formatAllergenLabel("crustacean_shellfish", { inline: true })).toBe("crustacean shellfish");
    expect(formatAllergenLabel("milk", { inline: true })).toBe("milk");
  });
});

// UX-01: the banner's coverage lines name what's behind and since when,
// grouped so the list stays short.
describe("coverageGapLines", () => {
  const now = new Date(2026, 10, 11, 12).getTime(); // Wed Nov 11 2026, noon local
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();

  test("says nothing about current sources", () => {
    expect(coverageGapLines([{ source: "fda", state: "current", lastSuccessAt: now }], now)).toEqual([]);
  });

  test("groups sources that went quiet in the same month, oldest first", () => {
    expect(
      coverageGapLines(
        [
          { source: "fda", state: "current", lastSuccessAt: now },
          { source: "cdc", state: "unavailable", lastSuccessAt: at(2026, 6, 2) },
          { source: "fsis", state: "unavailable", lastSuccessAt: at(2026, 6, 14) },
          { source: "fda_rss", state: "delayed", lastSuccessAt: at(2026, 10, 9) },
        ],
        now,
      ),
    ).toEqual([
      "CDC outbreaks and USDA meat & poultry: no updates since July.",
      "FDA press releases: no updates since Monday.",
    ]);
  });

  test("names sources that never loaded, and older years", () => {
    expect(
      coverageGapLines(
        [
          { source: "fsis", state: "unavailable", lastSuccessAt: 0 },
          { source: "cdc", state: "unavailable", lastSuccessAt: 0 },
          { source: "fda", state: "unavailable", lastSuccessAt: at(2025, 11, 1) },
          { source: "fda_rss", state: "delayed", lastSuccessAt: at(2026, 10, 1) },
        ],
        now,
      ),
    ).toEqual([
      "USDA meat & poultry and CDC outbreaks: no data yet.",
      "FDA recalls: no updates since December 2025.",
      "FDA press releases: no updates since Nov 1.",
    ]);
  });

  test("a gap from today reads as earlier today", () => {
    expect(
      coverageGapLines([{ source: "fsis", state: "delayed", lastSuccessAt: now - 5 * 3_600_000 }], now),
    ).toEqual(["USDA meat & poultry: no updates since earlier today."]);
  });
});

// UX-11: one formatter per concept, §11 wording for stored agency text.
describe("UX-11 copy formatters", () => {
  test("allergens are sentence case standalone, lowercase inline", () => {
    expect(formatAllergenLabel("crustacean_shellfish")).toBe("Crustacean shellfish");
    expect(formatAllergenLabel("Milk")).toBe("Milk");
    expect(reasonChipLabel("allergen", ["milk", "tree_nuts"])).toBe("Allergen: milk, tree nuts");
  });

  test("firm strings split on semicolons", () => {
    expect(firmNames("Chicken of the Sea; Thai Union")).toEqual(["Chicken of the Sea", "Thai Union"]);
    expect(firmNames("Acme Foods")).toEqual(["Acme Foods"]);
    expect(firmNames("Enjoy Nutrition, LLC; dba Weyland Brain Nutrition")).toEqual([
      "Enjoy Nutrition, LLC dba Weyland Brain Nutrition",
    ]);
  });

  test("stored timeline summaries lose bare agency jargon", () => {
    expect(plainTimelineSummary("Classification changed from Class II to Not Yet Classified")).toBe(
      "Risk level changed from moderate to not yet rated",
    );
    expect(plainTimelineSummary("States added: TX; classification changed from Class II to Class I")).toBe(
      "States added: TX; risk level changed from moderate to high",
    );
    expect(plainTimelineSummary("Initial notice")).toBe("Initial notice");
  });

  test("detail attribution names the real source", () => {
    expect(recallSourceAttribution({ source: "fsis", sourceUrl: "https://www.fsis.usda.gov/x" })).toBe(
      "USDA's Food Safety and Inspection Service",
    );
    expect(recallSourceAttribution({ source: "fda", sourceUrl: "https://api.fda.gov/food/enforcement.json?x" })).toBe(
      "FDA recall records",
    );
    expect(recallSourceAttribution({ source: "fda", sourceUrl: "https://www.fda.gov/safety/recalls/x" })).toBe(
      "FDA recall records and an FDA press release",
    );
  });
});
