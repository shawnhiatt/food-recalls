// Denormalized search text for Convex's full-text `searchIndex` (SPEC.md §10:
// "archived alerts stay reachable via search and pantry/scanner UPC checks").
// A search index covers a single string field, so we concatenate everything a
// user would search by — product name, company/brand, description, and the
// barcodes themselves — into one field. Pure so it's unit-testable and shared
// by the upsert paths and the one-off backfill migration (convex/migrations.ts).

// Convex caps a search field's indexed content; keep well under it. Recall
// descriptions run to a few hundred chars, so this only bites pathological rows.
const MAX_SEARCH_TEXT = 8000;

function join(parts: Array<string | undefined>): string {
  return parts
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .slice(0, MAX_SEARCH_TEXT);
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
