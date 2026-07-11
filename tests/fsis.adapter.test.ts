import { describe, expect, test } from "vitest";
import { normalizeBatch } from "../convex/adapters/types";
import { normalizeFsisRecord, parseFsisDate } from "../convex/adapters/fsis";
import recalls from "./fixtures/fsis/recalls.json";
import malformed from "./fixtures/fsis/recalls-malformed.json";

describe("parseFsisDate", () => {
  test("ISO passthrough", () => {
    expect(parseFsisDate("2026-06-15")).toBe("2026-06-15");
  });
  test("prose date parses", () => {
    expect(parseFsisDate("Jun 15, 2026")).toBe("2026-06-15");
  });
  test("garbage returns empty", () => {
    expect(parseFsisDate("sometime last spring")).toBe("");
    expect(parseFsisDate("")).toBe("");
  });
});

describe("FSIS adapter on a recorded response", () => {
  const { records, skipped } = normalizeBatch(recalls, normalizeFsisRecord);

  test("normalizes every well-formed record", () => {
    expect(records).toHaveLength(3);
    expect(skipped).toHaveLength(0);
  });

  test("active E. coli recall", () => {
    const rec = records.find((r) => r.sourceId === "013-2026")!;
    expect(rec.source).toBe("fsis");
    expect(rec.lifecycle).toBe("active");
    expect(rec.classification).toBe("Class I");
    expect(rec.states).toEqual(["GA", "NC", "SC"]);
    expect(rec.hazardType).toBe("microbial");
    expect(rec.firm).toBe("Carolina Meats Inc.");
    expect(rec.productCodes).toEqual(["041512338749"]);
    // Risk groups come from the summary's "who's at risk" sentence.
    expect(rec.riskGroups).toEqual(["child", "older_adult", "immunocompromised"]);
    // Summary HTML is stripped before enrichment.
    expect(rec.raw).toBeTruthy();
    // Relative press-release paths become absolute FSIS URLs.
    expect(rec.sourceUrl).toBe(
      "https://www.fsis.usda.gov/recalls-alerts/carolina-meats-inc-recalls-ground-beef-products",
    );
  });

  test("closed recall with undeclared sesame", () => {
    const rec = records.find((r) => r.sourceId === "009-2026")!;
    expect(rec.lifecycle).toBe("completed");
    expect(rec.allergens).toEqual(["sesame"]);
    expect(rec.hazardType).toBe("allergen");
    expect(rec.states).toEqual(["KY", "TN"]);
    // Absolute press-release URLs pass through untouched.
    expect(rec.sourceUrl).toBe(
      "https://www.fsis.usda.gov/recalls-alerts/sunrise-kitchens-llc-recalls-chicken-wrap-products",
    );
  });

  test("public health alert with empty field_states falls back to summary text", () => {
    const rec = records.find((r) => r.sourceId === "PHA-06022026-01")!;
    expect(rec.states).toEqual(["NM", "TX"]);
    expect(rec.hazardType).toBe("foreign_material");
    expect(rec.lifecycle).toBe("active");
  });

  test("hash stability across repeated normalization (§14)", () => {
    const again = normalizeBatch(recalls, normalizeFsisRecord);
    expect(again.records.map((r) => r.contentHash)).toEqual(
      records.map((r) => r.contentHash),
    );
  });
});

describe("FSIS adapter on malformed records", () => {
  const { records, skipped } = normalizeBatch(malformed, normalizeFsisRecord);

  test("bad records skipped with reasons, valid record survives", () => {
    expect(records.map((r) => r.sourceId)).toEqual(["014-2026"]);
    expect(skipped).toHaveLength(3);
    expect(skipped.map((s) => s.reason)).toEqual([
      "missing field_recall_number",
      "unparseable field_recall_date",
      "not an object",
    ]);
  });

  test("surviving record still enriches", () => {
    const rec = records[0]!;
    expect(rec.allergens).toEqual(["milk"]);
    expect(rec.states).toEqual(["MN", "WI"]);
    expect(rec.productCodes).toEqual(["123456789012"]);
  });
});
