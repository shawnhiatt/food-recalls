// Pantry matching (SPEC.md §7 "Pantry (Phase 7)" dimension) — pure so it's
// fixture-testable without a live Convex deployment, same pattern as
// convex/lib/matching.ts. Two rungs, exactly the §3 scanner fallback chain:
//   1. `pantryItems.upc ∩ alert.productCodes` — exact, high confidence.
//   2. Same-firm soft match ("same manufacturer has other active recalls") —
//      possible confidence, only tried when the UPC itself doesn't match.
// Never "safe": a non-match means "no known recall," not a guarantee (§3).

export type PantryMatchableItem = {
  upc: string;
  brand?: string;
};

// A subset of the recalls table; only ACTIVE recalls should be passed in —
// resolved recalls don't warrant a pantry warning (mirrors the §10 archive
// exclusion the rest of the app already applies).
export type PantryMatchableRecall = {
  _id: string;
  productCodes: string[];
  firm: string;
};

export type PantryMatch =
  | { matched: false }
  | { matched: true; confidence: "high" | "possible"; recallIds: string[] };

export function matchByUpc(upc: string, recalls: PantryMatchableRecall[]): string[] {
  return recalls.filter((r) => r.productCodes.includes(upc)).map((r) => r._id);
}

/** Bidirectional substring — "Acme" should match firm "Acme Foods, Inc." and vice versa. */
export function matchByFirm(brand: string, recalls: PantryMatchableRecall[]): string[] {
  const b = brand.trim().toLowerCase();
  if (!b) return [];
  return recalls
    .filter((r) => {
      const f = r.firm.trim().toLowerCase();
      return f.length > 0 && (f.includes(b) || b.includes(f));
    })
    .map((r) => r._id);
}

export function matchPantryItem(
  item: PantryMatchableItem,
  activeRecalls: PantryMatchableRecall[],
): PantryMatch {
  const exact = matchByUpc(item.upc, activeRecalls);
  if (exact.length > 0) return { matched: true, confidence: "high", recallIds: exact };

  if (item.brand) {
    const soft = matchByFirm(item.brand, activeRecalls);
    if (soft.length > 0) return { matched: true, confidence: "possible", recallIds: soft };
  }

  return { matched: false };
}

// Archived-recall scanner rung (SPEC.md §10: archived alerts "reachable via
// search and pantry/scanner UPC checks"). Distinct from the active rungs above:
// a scanned UPC that exactly matches a NON-active recall means "this product
// had a recall, since resolved" — informational, never an active warning. The
// caller pre-filters candidates via the full-text search index; this narrows
// them to exact, non-active UPC hits so a fuzzy search miss can't leak through.
export type ArchivedMatchableRecall = {
  _id: string;
  title: string;
  firm: string;
  lifecycle: string;
  productCodes: string[];
  updateHistory: Array<{ date: string }>;
  recallDate: string;
};

export type ArchivedRecallMatch = {
  _id: string;
  title: string;
  firm: string;
  resolvedDate: string; // ISO date the recall most likely closed
};

export function matchArchivedByUpc(
  upc: string,
  candidates: ArchivedMatchableRecall[],
): ArchivedRecallMatch[] {
  return candidates
    .filter((r) => r.lifecycle !== "active" && r.productCodes.includes(upc))
    .map((r) => ({
      _id: r._id,
      title: r.title,
      firm: r.firm,
      // Best "resolved" signal we store: the last timeline entry dates the
      // closure transition; fall back to the original recall date.
      resolvedDate: r.updateHistory[r.updateHistory.length - 1]?.date ?? r.recallDate,
    }));
}
