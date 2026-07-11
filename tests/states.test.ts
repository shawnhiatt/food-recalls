import { describe, expect, test } from "vitest";
import { normalizeStateList, parseStatesFromText } from "../convex/lib/states";

describe("parseStatesFromText", () => {
  test("nationwide keywords normalize to US", () => {
    expect(parseStatesFromText("Nationwide")).toEqual(["US"]);
    expect(parseStatesFromText("Distributed nationwide via retail")).toEqual(["US"]);
    expect(parseStatesFromText("Throughout the United States")).toEqual(["US"]);
  });

  test("comma lists of codes", () => {
    expect(parseStatesFromText("NC, SC, GA, and VA")).toEqual(["GA", "NC", "SC", "VA"]);
  });

  test("full state names, case-insensitive", () => {
    expect(parseStatesFromText("Distributed in Oregon and Washington")).toEqual([
      "OR",
      "WA",
    ]);
  });

  test("'West Virginia' does not also match Virginia", () => {
    expect(parseStatesFromText("West Virginia only")).toEqual(["WV"]);
  });

  test("lowercase English words are not state codes", () => {
    expect(parseStatesFromText("Distributed in stores or online, contact me")).toEqual(
      [],
    );
  });

  test("ALL-CAPS prose does not turn 'IN'/'OR' into states", () => {
    expect(parseStatesFromText("DISTRIBUTED IN GEORGIA OR ALABAMA")).toEqual([
      "AL",
      "GA",
    ]);
  });

  test("ALL-CAPS comma lists keep ambiguous codes", () => {
    expect(parseStatesFromText("AL, GA, IN, OK")).toEqual(["AL", "GA", "IN", "OK"]);
  });

  test("empty input", () => {
    expect(parseStatesFromText("")).toEqual([]);
  });
});

describe("normalizeStateList", () => {
  test("mixed names, codes, and nationwide", () => {
    expect(normalizeStateList(["Alabama", " GA ", "Nationwide", ""])).toEqual([
      "AL",
      "GA",
      "US",
    ]);
  });

  test("unknown values are dropped", () => {
    expect(normalizeStateList(["Atlantis", "XX"])).toEqual([]);
  });
});
