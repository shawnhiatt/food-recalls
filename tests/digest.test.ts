import { describe, expect, test } from "vitest";
import {
  digestSubject,
  getLocalHour,
  isDigestDue,
  reassuranceLine,
  renderDigestText,
  sortDigestItems,
  sourceStatusFooter,
  type DigestInput,
  type DigestItem,
} from "../convex/lib/digest";

const NOW = Date.UTC(2026, 6, 11, 21, 0, 0); // 2026-07-11 21:00 UTC

const currentSources: DigestInput["sources"] = [
  { source: "fda", state: "current", lastSuccessAt: NOW },
  { source: "fsis", state: "current", lastSuccessAt: NOW },
];

const degradedSources: DigestInput["sources"] = [
  { source: "fda", state: "current", lastSuccessAt: NOW },
  { source: "fsis", state: "delayed", lastSuccessAt: NOW - 5 * 24 * 3600 * 1000 },
];

const match: DigestItem = {
  kind: "match",
  title: "Listeria in spinach",
  firm: "Green Farm",
  severity: "class1",
  matchedOn: ["state", "allergen"],
  confidence: "high",
  url: "https://x/recalls/1",
};

function input(over: Partial<DigestInput> = {}): DigestInput {
  return {
    householdName: "Hiatt household",
    items: [],
    allSourcesCurrent: true,
    sources: currentSources,
    now: NOW,
    ...over,
  };
}

describe("empty digest — reassurance gate (§10)", () => {
  test("all sources current → all-clear reassurance", () => {
    const inp = input({ items: [], allSourcesCurrent: true });
    expect(digestSubject(inp)).toMatch(/all clear/i);
    expect(reassuranceLine(inp)).toMatch(/no new recalls affect your household/i);
    expect(reassuranceLine(inp)).toMatch(/current as of 2026-07-11/);
    const body = renderDigestText(inp);
    expect(body).toMatch(/no new recalls affect your household/i);
    expect(body).not.toMatch(/coverage incomplete/i);
  });

  test("a degraded source → explicit incompleteness, names the source", () => {
    const inp = input({
      items: [],
      allSourcesCurrent: false,
      sources: degradedSources,
    });
    expect(digestSubject(inp)).toMatch(/incomplete/i);
    const line = reassuranceLine(inp);
    expect(line).toMatch(/coverage incomplete/i);
    expect(line).toMatch(/USDA meat & poultry data/);
    expect(line).not.toMatch(/all clear/i);
    // Never claim all-clear when degraded.
    expect(renderDigestText(inp)).not.toMatch(/no new recalls affect your household\./i);
  });
});

describe("non-empty digest", () => {
  test("lists matched items with reason chips and a severity label", () => {
    const body = renderDigestText(input({ items: [match] }));
    expect(digestSubject(input({ items: [match] }))).toMatch(/1 new recall/i);
    expect(body).toMatch(/High risk/);
    expect(body).toMatch(/Listeria in spinach/);
    expect(body).toMatch(/Your state/);
    expect(body).toMatch(/Allergen match/);
  });

  test("'possible' matches are labeled", () => {
    const possible: DigestItem = { ...match, confidence: "possible", matchedOn: ["chain"] };
    expect(renderDigestText(input({ items: [possible] }))).toMatch(/possible match/i);
  });

  test("closure lines render under a resolved/updated heading", () => {
    const closure: DigestItem = {
      kind: "closure",
      title: "Old beef recall",
      lifecycle: "completed",
      url: "https://x/recalls/2",
    };
    const body = renderDigestText(input({ items: [match, closure] }));
    expect(body).toMatch(/Resolved \/ updated/i);
    expect(body).toMatch(/Old beef recall — resolved/);
  });

  test("even a non-empty digest carries the source-status footer", () => {
    expect(sourceStatusFooter(input({ items: [match] }))).toMatch(/current as of/i);
    expect(
      sourceStatusFooter(input({ allSourcesCurrent: false, sources: degradedSources })),
    ).toMatch(/coverage incomplete/i);
  });
});

describe("sortDigestItems", () => {
  test("matches sort by severity, closures last", () => {
    const c2: DigestItem = { ...match, severity: "class2", title: "C2" };
    const c1: DigestItem = { ...match, severity: "class1", title: "C1" };
    const closure: DigestItem = {
      kind: "closure",
      title: "Z",
      lifecycle: "terminated",
      url: "u",
    };
    const sorted = sortDigestItems([closure, c2, c1]);
    expect(sorted.map((i) => (i.kind === "match" ? i.title : "closure"))).toEqual([
      "C1",
      "C2",
      "closure",
    ]);
  });
});

describe("digest scheduling (§9)", () => {
  test("getLocalHour respects timezone", () => {
    // 21:00 UTC is 17:00 America/New_York (EDT, -4).
    expect(getLocalHour(NOW, "America/New_York")).toBe(17);
    expect(getLocalHour(NOW, "UTC")).toBe(21);
  });

  test("due only in the matching local hour", () => {
    expect(isDigestDue({ now: NOW, timezone: "America/New_York", digestHour: 17 })).toBe(true);
    expect(isDigestDue({ now: NOW, timezone: "America/New_York", digestHour: 18 })).toBe(false);
  });

  test("not due twice within the same day", () => {
    expect(
      isDigestDue({
        now: NOW,
        timezone: "UTC",
        digestHour: 21,
        lastDigestAt: NOW - 3600 * 1000, // sent an hour ago
      }),
    ).toBe(false);
  });

  test("invalid timezone falls back to UTC", () => {
    expect(getLocalHour(NOW, "Not/AZone")).toBe(21);
  });
});
