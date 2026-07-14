// Denormalized search text for Convex's full-text `searchIndex` (SPEC.md §10:
// "archived alerts stay reachable via search and pantry/scanner UPC checks").
// A search index covers a single string field, so we concatenate everything a
// user would search by — product name, company/brand, description, and the
// barcodes themselves — into one field. Pure so it's unit-testable and shared
// by the upsert paths and the one-off backfill migration (convex/migrations.ts).

// Convex caps a search field's indexed content; keep well under it. Recall
// descriptions run to a few hundred chars, so this only bites pathological rows.
const MAX_SEARCH_TEXT = 8000;

// Lowercased on the way in. Convex's real search index already matches
// case-insensitively, so this is a no-op there — but it keeps the stored text
// and the (also-lowercased) query term on equal footing, which the callers rely
// on. Callers must pass the query through `normalizeSearchQuery` to match.
function join(parts: Array<string | undefined>): string {
  return parts
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .toLowerCase()
    .slice(0, MAX_SEARCH_TEXT);
}

/** Normalize a user's query the same way `searchText` is stored (see `join`). */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export type RecallSearchFields = {
  title: string;
  firm: string;
  productDesc: string;
  productCodes: string[];
};

export function buildRecallSearchText(r: RecallSearchFields): string {
  return join([r.title, r.firm, r.productDesc, ...r.productCodes]);
}

export type OutbreakSearchFields = {
  title: string;
  pathogen: string;
  suspectedFood?: string;
};

export function buildOutbreakSearchText(o: OutbreakSearchFields): string {
  return join([o.title, o.pathogen, o.suspectedFood]);
}
