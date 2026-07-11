import type { Audience, HazardType } from "../lib/enrichment";
import type { Lifecycle } from "../lib/lifecycle";

// Adapter contract (SPEC.md §4): every source adapter takes one raw record and
// emits either a fully normalized + enriched record, or a skip with a reason.
// Adapters are pure functions — no I/O — so they are tested with fixtures.

export type NormalizedRecall = {
  source: "fda" | "fsis";
  sourceId: string;
  title: string;
  firm: string;
  classification: string;
  rawStatus: string;
  lifecycle: Lifecycle;
  recallDate: string; // ISO date (YYYY-MM-DD)
  productDesc: string;
  states: string[];
  distribution: string;
  productCodes: string[];
  allergens: string[];
  audience: Audience;
  hazardType: HazardType;
  riskGroups: string[];
  sourceUrl: string;
  raw: unknown;
  contentHash: string;
};

export type AdapterResult =
  | { ok: true; record: NormalizedRecall }
  | { ok: false; reason: string; raw: unknown };

export function normalizeBatch(
  rawRecords: unknown[],
  normalizeOne: (raw: unknown) => AdapterResult,
): { records: NormalizedRecall[]; skipped: Array<{ reason: string; raw: unknown }> } {
  const records: NormalizedRecall[] = [];
  const skipped: Array<{ reason: string; raw: unknown }> = [];
  for (const raw of rawRecords) {
    const result = normalizeOne(raw);
    if (result.ok) records.push(result.record);
    else skipped.push({ reason: result.reason, raw: result.raw });
  }
  return { records, skipped };
}
