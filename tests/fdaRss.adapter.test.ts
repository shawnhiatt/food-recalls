import { describe, expect, test } from "vitest";
import {
  firmsLikelySame,
  isFoodRelated,
  normalizeFirmName,
  parsePressPage,
  parseRssDate,
  parseRssItems,
} from "../convex/adapters/fdaRss";
import { extractRiskGroups } from "../convex/lib/enrichment";
import rssXml from "./fixtures/fda_rss/recalls-rss.xml?raw";
import pressHtml from "./fixtures/fda_rss/press-page.html?raw";

// Recorded from the live feed / a live press page on 2026-07-12 (§14: test
// adapters with fixtures, not live calls). The RSS fixture includes a
// malformed item (no link/guid) that must be skipped, not crash the parse.

describe("parseRssItems (FDA recalls RSS)", () => {
  test("parses items with url, title, description, guid, ISO date", () => {
    const items = parseRssItems(rssXml);
    expect(items).toHaveLength(3); // 4 in fixture; the link-less one is skipped

    const blueberries = items[1]!;
    expect(blueberries.url).toBe(
      "http://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/frutas-y-hortalizas-del-sur-sa-initiates-recall-frozen-greenwise-organic-iqf-blueberries-due",
    );
    expect(blueberries.guid).toBe(blueberries.url);
    expect(blueberries.title).toContain("Frutas y Hortalizas del Sur S.A.");
    expect(blueberries.publishedAt).toBe("2026-07-03");
  });

  test("decodes XML entities in titles", () => {
    const items = parseRssItems(rssXml);
    expect(items[2]!.title).toContain("Chicken & Duck Flavor");
  });

  test("garbage input parses to zero items, never throws", () => {
    expect(parseRssItems("")).toEqual([]);
    expect(parseRssItems("<html>not a feed</html>")).toEqual([]);
    expect(parseRssItems("<rss><item><title>only a title</title></item></rss>")).toEqual([]);
  });

  test("parseRssDate handles RFC-822 with US timezone abbreviations", () => {
    expect(parseRssDate("Mon, 06 Jul 2026 13:49:00 EDT")).toBe("2026-07-06");
    expect(parseRssDate("not a date")).toBe("");
    expect(parseRssDate("")).toBe("");
  });
});

describe("parsePressPage (press-release HTML)", () => {
  const press = parsePressPage(pressHtml);

  test("extracts the summary panel fields", () => {
    expect(press.companyName).toBe("Frutas y Hortalizas del Sur S.A.");
    expect(press.productType).toContain("Food & Beverages");
    expect(press.brandNames).toEqual(["GreenWise"]);
    expect(press.productDescription).toBe("Organic IQF Frozen Blueberries 10 oz");
  });

  test("resolves the product photo (under /files/), not site chrome or og:image", () => {
    expect(press.imageUrl).toBe(
      "https://www.fda.gov/files/styles/recall_image_small/public/image_1_194.png?itok=dVbuViWR",
    );
  });

  test("body text feeds risk-group extraction (§4 step 4)", () => {
    expect(press.bodyText).toContain("hemolytic uremic syndrome");
    const riskGroups = extractRiskGroups(press.bodyText);
    expect(riskGroups).toContain("child");
    expect(riskGroups).toContain("older_adult");
    expect(riskGroups).toContain("immunocompromised");
  });

  test("empty page yields empty fields, never throws", () => {
    const empty = parsePressPage("<html></html>");
    expect(empty.companyName).toBe("");
    expect(empty.imageUrl).toBeUndefined();
    expect(empty.brandNames).toEqual([]);
  });
});

describe("food relevance + firm matching", () => {
  test("isFoodRelated keeps food/pet items, drops drugs/devices, keeps unknowns", () => {
    expect(isFoodRelated("Food & Beverages Foodborne Illness")).toBe(true);
    expect(isFoodRelated("Animal & Veterinary")).toBe(true);
    expect(isFoodRelated("Dietary Supplements")).toBe(true);
    expect(isFoodRelated("Drugs")).toBe(false);
    expect(isFoodRelated("Medical Devices")).toBe(false);
    expect(isFoodRelated("")).toBe(true); // inclusive bias
  });

  test("normalizeFirmName strips punctuation, suffixes, and initials", () => {
    expect(normalizeFirmName("Frutas y Hortalizas del Sur S.A.")).toBe(
      "frutas hortalizas del sur",
    );
    expect(normalizeFirmName("Mars Petcare US, Inc.")).toBe("mars petcare");
  });

  test("firmsLikelySame matches press names against enforcement firm names", () => {
    expect(firmsLikelySame("Mars Petcare US, Inc.", "Mars Petcare")).toBe(true);
    expect(
      firmsLikelySame("Frutas y Hortalizas del Sur S.A.", "Frutas y Hortalizas del Sur SA"),
    ).toBe(true);
    expect(firmsLikelySame("Mars Petcare US, Inc.", "Acme Foods")).toBe(false);
    // Too-short normalized names never match (guards against "" ⊆ everything).
    expect(firmsLikelySame("Co. Inc.", "Acme Foods")).toBe(false);
  });
});
