import {
  classifyAudience,
  classifyHazard,
  extractAllergens,
  extractProductCodes,
  extractRiskGroups,
} from "../lib/enrichment";
import { parseStatesFromText } from "../lib/states";
import { mapFdaLifecycle } from "../lib/lifecycle";
import { computeContentHash } from "../lib/contentHash";
import type { AdapterResult } from "./types";

// openFDA Food Enforcement adapter.
// API: https://api.fda.gov/food/enforcement.json — results[] of enforcement
// reports. Notable quirks (SPEC.md §15): openFDA mutates old records in place,
// dates are bare "YYYYMMDD" strings, distribution_pattern is free text, and
// code_info mixes UPCs with lot codes and prose.

/** Loosely-typed shape of one openFDA enforcement result. */
type OpenFdaRecord = {
  recall_number?: unknown;
  status?: unknown;
  classification?: unknown;
  recalling_firm?: unknown;
  product_description?: unknown;
  reason_for_recall?: unknown;
  distribution_pattern?: unknown;
  code_info?: unknown;
  recall_initiation_date?: unknown;
  report_date?: unknown;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** "20240115" → "2024-01-15"; empty string when unparseable. */
export function parseFdaDate(value: unknown): string {
  const digits = str(value).replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function normalizeOpenFdaRecord(raw: unknown): AdapterResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "not an object", raw };
  }
  const record = raw as OpenFdaRecord;

  const sourceId = str(record.recall_number);
  if (!sourceId) {
    return { ok: false, reason: "missing recall_number", raw };
  }

  const recallDate =
    parseFdaDate(record.recall_initiation_date) || parseFdaDate(record.report_date);
  if (!recallDate) {
    return { ok: false, reason: "unparseable recall_initiation_date and report_date", raw };
  }

  const productDesc = str(record.product_description);
  const reason = str(record.reason_for_recall);
  const firm = str(record.recalling_firm);
  const distribution = str(record.distribution_pattern);
  const rawStatus = str(record.status);
  const classification = str(record.classification);

  const enrichmentText = `${reason} ${productDesc}`;
  const allergens = extractAllergens(enrichmentText);
  const title = productDesc
    ? productDesc.length > 140
      ? `${productDesc.slice(0, 137)}...`
      : productDesc
    : firm || sourceId;

  return {
    ok: true,
    record: {
      source: "fda",
      sourceId,
      title,
      firm,
      classification,
      rawStatus,
      lifecycle: mapFdaLifecycle(rawStatus),
      recallDate,
      productDesc,
      states: parseStatesFromText(distribution),
      distribution,
      productCodes: extractProductCodes(str(record.code_info)),
      allergens,
      audience: classifyAudience(productDesc, firm),
      hazardType: classifyHazard(reason, allergens),
      riskGroups: extractRiskGroups(reason),
      // openFDA has no per-record public page; Phase 1 press ingest supplies
      // real notice URLs. Until then link the canonical API record (§3: always
      // deep-link to the official source).
      sourceUrl: `https://api.fda.gov/food/enforcement.json?search=recall_number:%22${encodeURIComponent(sourceId)}%22`,
      raw,
      contentHash: computeContentHash({
        classification,
        rawStatus,
        lifecycle: mapFdaLifecycle(rawStatus),
        states: parseStatesFromText(distribution),
        allergens,
        productDesc,
        productCodes: extractProductCodes(str(record.code_info)),
      }),
    },
  };
}
