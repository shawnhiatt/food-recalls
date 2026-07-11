import { describe, expect, test } from "vitest";
import {
  classifyAudience,
  classifyHazard,
  extractAllergens,
  extractProductCodes,
  extractRiskGroups,
} from "../convex/lib/enrichment";

describe("extractAllergens", () => {
  test("direct mentions", () => {
    expect(extractAllergens("Undeclared milk in dark chocolate")).toEqual(["milk"]);
    expect(extractAllergens("may contain peanuts and tree nuts")).toEqual([
      "tree_nuts",
      "peanuts",
    ]);
  });

  test("synonyms count (false-positive bias, §4)", () => {
    expect(extractAllergens("contains whey protein")).toContain("milk");
    expect(extractAllergens("processed with tahini")).toContain("sesame");
    expect(extractAllergens("undeclared casein")).toContain("milk");
    expect(extractAllergens("almond clusters")).toContain("tree_nuts");
    expect(extractAllergens("soy lecithin emulsifier")).toContain("soy");
    expect(extractAllergens("contains gluten")).toContain("wheat");
  });

  test("cheese varieties tag milk (§14 spot-check misses, docs/enrichment-spot-check.md)", () => {
    expect(extractAllergens("Roast beef and cheddar closed face sandwich")).toContain("milk");
    expect(extractAllergens("HARD-COOKED EGG SALAME & PROVOLONE")).toContain("milk");
    expect(extractAllergens("Nutrisystem Chocolate Cheesecake")).toContain("milk");
    expect(extractAllergens("fresh mozzarella and parmesan blend")).toContain("milk");
    // "butternut" must not false-positive on \bbutter\b.
    expect(extractAllergens("Roasting Cinnamon Butternut Squash")).toEqual([]);
  });

  test("no allergen text", () => {
    expect(extractAllergens("metal fragments in granola")).toEqual([]);
    expect(extractAllergens("")).toEqual([]);
  });
});

describe("classifyAudience", () => {
  test("pet needs a strong signal (false-negative bias, §4)", () => {
    expect(classifyAudience("Chicken & Rice Dry Dog Food, 15 lb", "Prairie Paws")).toBe(
      "pet",
    );
    expect(classifyAudience("Salmon kibble for cats", "Ocean Co")).toBe("pet");
    // Ambiguous product from a pet-named firm without pet wording stays human.
    expect(classifyAudience("Chicken jerky strips", "Family Foods LLC")).toBe("human");
  });

  test("ordinary food is human", () => {
    expect(classifyAudience("Frozen Organic Spinach, 10 oz", "Valley Verde")).toBe(
      "human",
    );
  });

  test("no text at all is unknown (displays under human)", () => {
    expect(classifyAudience("", "")).toBe("unknown");
  });
});

describe("classifyHazard", () => {
  test("microbial outranks allergen wording", () => {
    expect(
      classifyHazard("Listeria monocytogenes found; label also missing undeclared milk", [
        "milk",
      ]),
    ).toBe("microbial");
    expect(classifyHazard("potential Salmonella contamination", [])).toBe("microbial");
    expect(classifyHazard("E. coli O157:H7", [])).toBe("microbial");
  });

  test("foreign material", () => {
    expect(classifyHazard("may contain small metal fragments", [])).toBe(
      "foreign_material",
    );
    expect(classifyHazard("pieces of plastic found in product", [])).toBe(
      "foreign_material",
    );
  });

  test("allergen hazards", () => {
    expect(classifyHazard("Undeclared soy", ["soy"])).toBe("allergen");
    expect(classifyHazard("Misbranding, Unreported Allergens", ["sesame"])).toBe(
      "allergen",
    );
  });

  test("other", () => {
    expect(classifyHazard("net weight misprint on bottles", [])).toBe("other");
  });
});

describe("extractRiskGroups", () => {
  test("press-style risk text", () => {
    expect(
      extractRiskGroups(
        "poses the greatest risk to pregnant women, older adults, and persons with weakened immune systems",
      ),
    ).toEqual(["pregnant", "older_adult", "immunocompromised"]);
  });

  test("infants and children", () => {
    expect(extractRiskGroups("Young children and infants are most at risk")).toEqual([
      "infant",
      "child",
    ]);
  });

  test("empty", () => {
    expect(extractRiskGroups("")).toEqual([]);
  });
});

describe("extractProductCodes", () => {
  test("UPCs with spaces and dashes normalize to digit strings", () => {
    expect(extractProductCodes("UPC 0 12345 67890 5; Lot 24A17")).toEqual([
      "012345678905",
    ]);
    expect(extractProductCodes("UPC 071279-30415")).toEqual(["07127930415"]);
  });

  test("short lot numbers are not UPCs", () => {
    expect(extractProductCodes("Lots 26114, 26115, 26116")).toEqual([]);
  });

  test("plain 12-digit UPC", () => {
    expect(extractProductCodes("UPC 123456789012")).toEqual(["123456789012"]);
  });
});
