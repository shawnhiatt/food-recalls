import { describe, expect, test } from "vitest";
import { normalizeBatch } from "../convex/adapters/types";
import { normalizeOpenFdaRecord, parseFdaDate } from "../convex/adapters/openfda";
import page from "./fixtures/openfda/enforcement-page.json";
import malformed from "./fixtures/openfda/enforcement-malformed.json";

describe("parseFdaDate", () => {
  test("YYYYMMDD to ISO", () => {
    expect(parseFdaDate("20260528")).toBe("2026-05-28");
  });
  test("garbage returns empty", () => {
    expect(parseFdaDate("2026136")).toBe("");
    expect(parseFdaDate("not-a-date")).toBe("");
    expect(parseFdaDate(undefined)).toBe("");
    expect(parseFdaDate("20261488")).toBe("");
  });
});

describe("openFDA adapter on a recorded page", () => {
  const { records, skipped } = normalizeBatch(page.results, normalizeOpenFdaRecord);

  test("normalizes every well-formed record", () => {
    expect(records).toHaveLength(5);
    expect(skipped).toHaveLength(0);
  });

  test("undeclared-milk recall: allergen + states + codes", () => {
    const rec = records.find((r) => r.sourceId === "F-1201-2026")!;
    expect(rec.source).toBe("fda");
    expect(rec.classification).toBe("Class II");
    expect(rec.lifecycle).toBe("active");
    expect(rec.recallDate).toBe("2026-05-28");
    expect(rec.states).toEqual(["GA", "NC", "SC", "VA"]);
    expect(rec.allergens).toEqual(["milk"]);
    expect(rec.hazardType).toBe("allergen");
    expect(rec.audience).toBe("human");
    expect(rec.productCodes).toEqual(["012345678905"]);
    expect(rec.firm).toBe("Blue Ridge Confections LLC");
    expect(rec.sourceUrl).toContain("F-1201-2026");
  });

  test("listeria recall: nationwide, microbial, risk groups from reason", () => {
    const rec = records.find((r) => r.sourceId === "F-1187-2026")!;
    expect(rec.states).toEqual(["US"]);
    expect(rec.hazardType).toBe("microbial");
    expect(rec.classification).toBe("Class I");
    expect(rec.riskGroups).toEqual(["pregnant", "older_adult", "immunocompromised"]);
  });

  test("dog food recall classifies as pet audience", () => {
    const rec = records.find((r) => r.sourceId === "F-1179-2026")!;
    expect(rec.audience).toBe("pet");
    expect(rec.hazardType).toBe("microbial");
    expect(rec.states).toEqual(["IA", "KS", "MO", "NE"]);
  });

  test("metal fragments classify as foreign material", () => {
    const rec = records.find((r) => r.sourceId === "F-1163-2026")!;
    expect(rec.hazardType).toBe("foreign_material");
    expect(rec.states).toEqual(["CA", "NV"]);
  });

  test("terminated Class III maps lifecycle and full-name states", () => {
    const rec = records.find((r) => r.sourceId === "F-0998-2026")!;
    expect(rec.lifecycle).toBe("terminated");
    expect(rec.states).toEqual(["OR", "WA"]);
    expect(rec.hazardType).toBe("other");
  });

  test("hash stability: normalizing the same raw twice is identical (§14)", () => {
    const again = normalizeBatch(page.results, normalizeOpenFdaRecord);
    expect(again.records.map((r) => r.contentHash)).toEqual(
      records.map((r) => r.contentHash),
    );
  });

  test("immaterial raw noise does not change the hash", () => {
    const noisy = structuredClone(page.results[0]) as Record<string, unknown>;
    noisy["report_date"] = "20260617"; // openFDA touches this on re-publish
    noisy["product_quantity"] = "1,900 bars";
    const result = normalizeOpenFdaRecord(noisy);
    expect(result.ok && result.record.contentHash).toBe(records[0]!.contentHash);
  });

  test("material change (states added) changes the hash", () => {
    const changed = structuredClone(page.results[0]) as Record<string, unknown>;
    changed["distribution_pattern"] = "NC, SC, GA, VA, and TX";
    const result = normalizeOpenFdaRecord(changed);
    expect(result.ok && result.record.contentHash).not.toBe(records[0]!.contentHash);
  });
});

describe("openFDA adapter on malformed records", () => {
  const { records, skipped } = normalizeBatch(
    malformed.results,
    normalizeOpenFdaRecord,
  );

  test("bad records are skipped with reasons, good ones survive", () => {
    expect(records.map((r) => r.sourceId)).toEqual(["F-NULLS-2026", "F-GOOD-2026"]);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]!.reason).toContain("recall_number");
    expect(skipped[1]!.reason).toContain("date");
  });

  test("null fields normalize to safe defaults instead of crashing", () => {
    const nulls = records.find((r) => r.sourceId === "F-NULLS-2026")!;
    expect(nulls.productDesc).toBe("");
    expect(nulls.firm).toBe("");
    expect(nulls.states).toEqual([]);
    expect(nulls.lifecycle).toBe("active");
    expect(nulls.audience).toBe("unknown");
    expect(nulls.title).toBe("F-NULLS-2026");
  });

  test("non-object input is rejected", () => {
    expect(normalizeOpenFdaRecord(null).ok).toBe(false);
    expect(normalizeOpenFdaRecord("junk").ok).toBe(false);
  });
});
