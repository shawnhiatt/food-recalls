import { describe, expect, test } from "vitest";
import { classifyRiskLevel, formatAllergenLabel } from "../lib/copy";

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
    expect(formatAllergenLabel("crustacean_shellfish")).toBe("crustacean shellfish");
    expect(formatAllergenLabel("milk")).toBe("milk");
  });
});
