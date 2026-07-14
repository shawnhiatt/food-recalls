import { describe, expect, test } from "vitest";
import { buildRecallSearchText, buildOutbreakSearchText } from "../convex/lib/search";
import { matchArchivedByUpc } from "../convex/lib/pantry";

// §10: denormalized search text (product name, firm, description, barcodes) and
// the archived-recall scanner narrowing that rides on top of the full-text
// index. Both are pure — the live searchIndex path is covered in pantry.test.ts.

describe("buildRecallSearchText (§10)", () => {
  test("concatenates title, firm, description, and every barcode", () => {
    const text = buildRecallSearchText({
      title: "Peanut Butter Recall",
      firm: "Acme Foods",
      productDesc: "16oz creamy jars",
      productCodes: ["012345678905", "099999999999"],
    });
    expect(text).toBe("Peanut Butter Recall Acme Foods 16oz creamy jars 012345678905 099999999999");
  });

  test("drops blank/whitespace-only parts so tokens stay clean", () => {
    expect(
      buildRecallSearchText({ title: "  Title ", firm: "", productDesc: "   ", productCodes: [""] }),
    ).toBe("Title");
  });

  test("caps pathological lengths", () => {
    const huge = "x".repeat(20000);
    expect(buildRecallSearchText({ title: huge, firm: "", productDesc: "", productCodes: [] }).length)
      .toBeLessThanOrEqual(8000);
  });
});

describe("buildOutbreakSearchText (§10)", () => {
  test("includes title, pathogen, and suspected food when present", () => {
    expect(
      buildOutbreakSearchText({ title: "Listeria outbreak", pathogen: "Listeria", suspectedFood: "cantaloupe" }),
    ).toBe("Listeria outbreak Listeria cantaloupe");
  });

  test("omits an absent suspected food", () => {
    expect(buildOutbreakSearchText({ title: "E. coli", pathogen: "E. coli O157" })).toBe(
      "E. coli E. coli O157",
    );
  });
});

describe("matchArchivedByUpc (§10 scanner rung)", () => {
  const base = { title: "Old Recall", firm: "Acme", updateHistory: [{ date: "2025-03-01" }], recallDate: "2024-11-02" };

  test("keeps only non-active recalls whose codes exactly contain the UPC", () => {
    const out = matchArchivedByUpc("012345", [
      { _id: "r1", lifecycle: "terminated", productCodes: ["012345"], ...base },
      { _id: "r2", lifecycle: "active", productCodes: ["012345"], ...base }, // active → excluded
      { _id: "r3", lifecycle: "completed", productCodes: ["999999"], ...base }, // wrong UPC → excluded
    ]);
    expect(out.map((r) => r._id)).toEqual(["r1"]);
  });

  test("resolved date comes from the last timeline entry, falling back to recallDate", () => {
    const [withHistory] = matchArchivedByUpc("012345", [
      { _id: "r1", lifecycle: "terminated", productCodes: ["012345"], ...base },
    ]);
    expect(withHistory!.resolvedDate).toBe("2025-03-01");

    const [noHistory] = matchArchivedByUpc("012345", [
      { _id: "r2", lifecycle: "terminated", productCodes: ["012345"], title: "x", firm: "y", updateHistory: [], recallDate: "2024-11-02" },
    ]);
    expect(noHistory!.resolvedDate).toBe("2024-11-02");
  });

  test("a coarse search hit that isn't an exact UPC match is dropped", () => {
    // The full-text index can surface a recall because the UPC appears in its
    // description text, not its productCodes — narrowing must reject it.
    const out = matchArchivedByUpc("012345", [
      { _id: "r1", lifecycle: "terminated", productCodes: ["different"], ...base },
    ]);
    expect(out).toEqual([]);
  });
});
