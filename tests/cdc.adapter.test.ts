import { describe, expect, test } from "vitest";
import {
  isFoodbornePathogenTitle,
  normalizeOutbreak,
  parseOutbreakDetailPage,
  parseOutbreakListItems,
  parseOutbreakTitle,
  sourceIdFromUrl,
} from "../convex/adapters/cdc";
import listHtml from "./fixtures/cdc/outbreaks-list.html?raw";
import ecoliHtml from "./fixtures/cdc/outbreak-detail-ecoli.html?raw";
import poultryHtml from "./fixtures/cdc/outbreak-detail-poultry.html?raw";
import closedHtml from "./fixtures/cdc/outbreak-detail-closed.html?raw";

// Recorded from the live CDC outbreak list + investigation pages on
// 2026-07-13 (§14 Phase 4: "CDC fixtures"). No clean structured API (§3), so
// this scrapes CDC's own "Current Outbreak List" landing page and each
// investigation's detail page — regex-based like the FDA RSS adapter, since
// Convex actions have no DOMParser.

describe("parseOutbreakListItems", () => {
  test("parses items from the U.S. Outbreaks section only, normalizing relative URLs", () => {
    const items = parseOutbreakListItems(listHtml);
    // 5 items in the U.S. Outbreaks section; the Ebola item lives in the
    // International Outbreaks section just past the boundary and must not
    // leak in.
    expect(items).toHaveLength(5);
    expect(items.some((i) => i.title === "Ebola")).toBe(false);

    const blueberries = items[0]!;
    expect(blueberries.url).toBe(
      "https://www.cdc.gov/ecoli/outbreaks/blueberries-07-26/index.html",
    );
    expect(blueberries.title).toBe("E. coli Outbreak Linked to Frozen Blueberries");
    expect(blueberries.publishedAt).toBe("2026-07-07");

    // Relative href in the source markup — a real quirk of this page.
    const poultry = items.find((i) => i.title.includes("Backyard Poultry"))!;
    expect(poultry.url).toBe("https://www.cdc.gov/salmonella/outbreaks/saintpaul-04-26/index.html");
  });

  test("garbage input parses to zero items, never throws (§10 zero-record anomaly input)", () => {
    expect(parseOutbreakListItems("")).toEqual([]);
    expect(parseOutbreakListItems("<html>not the expected markup</html>")).toEqual([]);
  });
});

describe("isFoodbornePathogenTitle", () => {
  test("keeps recognized foodborne/zoonotic-enteric pathogens", () => {
    expect(isFoodbornePathogenTitle("E. coli Outbreak Linked to Frozen Blueberries")).toBe(true);
    expect(isFoodbornePathogenTitle("Salmonella Outbreak Linked to Moringa Capsules")).toBe(true);
    expect(isFoodbornePathogenTitle("Listeria Outbreak linked to Soft Cheese")).toBe(true);
    expect(isFoodbornePathogenTitle("Infant Botulism Outbreak Linked to Powdered Infant Formula")).toBe(
      true,
    );
  });

  test("drops non-foodborne investigations (Measles, COVID-19, etc.)", () => {
    expect(isFoodbornePathogenTitle("Measles Outbreaks 2025")).toBe(false);
    expect(isFoodbornePathogenTitle("Coronavirus Disease 2019 (COVID-19)")).toBe(false);
    expect(isFoodbornePathogenTitle("Mpox Outbreaks")).toBe(false);
  });
});

describe("parseOutbreakTitle", () => {
  test("splits pathogen and suspected food across singular/plural 'Outbreak(s) linked to'", () => {
    expect(parseOutbreakTitle("E. coli Outbreak Linked to Frozen Blueberries")).toEqual({
      pathogen: "E. coli",
      suspectedFood: "Frozen Blueberries",
    });
    expect(parseOutbreakTitle("Salmonella Outbreaks Linked to Backyard Poultry")).toEqual({
      pathogen: "Salmonella",
      suspectedFood: "Backyard Poultry",
    });
    expect(parseOutbreakTitle("Infant Botulism Outbreak Linked to Powdered Infant Formula")).toEqual({
      pathogen: "Infant Botulism",
      suspectedFood: "Powdered Infant Formula",
    });
  });

  test("falls back to the whole title when the pattern doesn't match", () => {
    expect(parseOutbreakTitle("Unusual Outbreak Title Format")).toEqual({
      pathogen: "Unusual Outbreak Title Format",
    });
  });
});

describe("parseOutbreakDetailPage", () => {
  test("extracts date, status, and fast-facts counts from a clean page", () => {
    const detail = parseOutbreakDetailPage(ecoliHtml);
    expect(detail.publishedAt).toBe("2026-07-06");
    expect(detail.investigationStatus).toBe("active");
    expect(detail.cases).toBe(12);
    expect(detail.hospitalizations).toBe(4);
    expect(detail.bodyText).toContain("hemolytic uremic syndrome");
  });

  test("reduces messy fast-facts text ('513 (New: 329)') to a leading integer", () => {
    const detail = parseOutbreakDetailPage(poultryHtml);
    expect(detail.investigationStatus).toBe("active"); // "Open"
    expect(detail.cases).toBe(513);
    expect(detail.hospitalizations).toBe(134);
  });

  test("maps 'Closed' investigation status to resolved", () => {
    const detail = parseOutbreakDetailPage(closedHtml);
    expect(detail.investigationStatus).toBe("resolved");
    expect(detail.cases).toBe(9);
  });

  test("empty page yields empty/undefined fields, never throws", () => {
    const detail = parseOutbreakDetailPage("<html></html>");
    expect(detail.publishedAt).toBe("");
    expect(detail.investigationStatus).toBe("active"); // safe-direction default
    expect(detail.cases).toBeUndefined();
    expect(detail.hospitalizations).toBeUndefined();
  });
});

describe("normalizeOutbreak", () => {
  const items = parseOutbreakListItems(listHtml);
  const blueberries = items.find((i) => i.title.includes("Blueberries"))!;

  test("combines list item + detail page into a NormalizedOutbreak", () => {
    const detail = parseOutbreakDetailPage(ecoliHtml);
    const outbreak = normalizeOutbreak(blueberries, detail);

    expect(outbreak.sourceId).toBe("ecoli/outbreaks/blueberries-07-26");
    expect(outbreak.pathogen).toBe("E. coli");
    expect(outbreak.suspectedFood).toBe("Frozen Blueberries");
    expect(outbreak.status).toBe("active");
    expect(outbreak.caseCount).toBe(12);
    expect(outbreak.hospitalizations).toBe(4);
    // Best-effort state extraction from the recalled-product distribution
    // prose on the detail page (§7 "matching degrades to state + keyword").
    expect(outbreak.states).toEqual(
      expect.arrayContaining(["AL", "FL", "GA", "KY", "NC", "SC", "TN", "VA"]),
    );
    expect(outbreak.riskGroups.length).toBeGreaterThanOrEqual(0);
    expect(outbreak.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("thin outbreak with no named states still normalizes cleanly (no crash)", () => {
    const poultryItem = items.find((i) => i.title.includes("Backyard Poultry"))!;
    const detail = parseOutbreakDetailPage(poultryHtml);
    const outbreak = normalizeOutbreak(poultryItem, detail);
    // No state names appear in this fixture's body text — parseStatesFromText's
    // existing nationwide detection (shared with FSIS, §4 enrichment step 5)
    // still generously reads "a U.S. territory" as a nationwide signal, which
    // is the same accepted over-inclusive bias used elsewhere, not new logic.
    expect(outbreak.states).toEqual(["US"]);
    expect(outbreak.riskGroups).toEqual(expect.arrayContaining(["child", "older_adult", "immunocompromised"]));
  });

  test("same inputs produce the same content hash (upsert idempotence)", () => {
    const detail = parseOutbreakDetailPage(ecoliHtml);
    const a = normalizeOutbreak(blueberries, detail);
    const b = normalizeOutbreak(blueberries, detail);
    expect(a.contentHash).toBe(b.contentHash);
  });
});

describe("sourceIdFromUrl", () => {
  test("strips origin and trailing index.html", () => {
    expect(sourceIdFromUrl("https://www.cdc.gov/ecoli/outbreaks/blueberries-07-26/index.html")).toBe(
      "ecoli/outbreaks/blueberries-07-26",
    );
    expect(sourceIdFromUrl("/salmonella/outbreaks/saintpaul-04-26/index.html")).toBe(
      "salmonella/outbreaks/saintpaul-04-26",
    );
  });
});
