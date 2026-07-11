import {
  classifyAudience,
  classifyHazard,
  extractAllergens,
  extractProductCodes,
  extractRiskGroups,
} from "../lib/enrichment";
import { normalizeStateList, parseStatesFromText } from "../lib/states";
import { mapFsisLifecycle } from "../lib/lifecycle";
import { computeContentHash } from "../lib/contentHash";
import type { AdapterResult } from "./types";

// USDA FSIS Recall API adapter (meat, poultry, egg products — FDA does not
// regulate these). API: https://www.fsis.usda.gov/fsis/api/recall/v/1 — a flat
// JSON array whose fields are Drupal-style `field_*` strings. States arrive as
// a comma-separated list of full names; summaries contain HTML.

type FsisRecord = {
  field_recall_number?: unknown;
  field_title?: unknown;
  field_recall_date?: unknown;
  field_recall_classification?: unknown;
  field_recall_type?: unknown;
  field_active_notice?: unknown;
  field_closed_date?: unknown;
  field_states?: unknown;
  field_establishment?: unknown;
  field_product_items?: unknown;
  field_summary?: unknown;
  field_recall_reason?: unknown;
  field_risk_level?: unknown;
  field_press_release?: unknown;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** FSIS dates arrive as ISO "YYYY-MM-DD" or "Mon DD, YYYY"; empty if neither. */
export function parseFsisDate(value: unknown): string {
  const text = str(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function normalizeFsisRecord(raw: unknown): AdapterResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "not an object", raw };
  }
  const record = raw as FsisRecord;

  const sourceId = str(record.field_recall_number);
  if (!sourceId) {
    return { ok: false, reason: "missing field_recall_number", raw };
  }

  const recallDate = parseFsisDate(record.field_recall_date);
  if (!recallDate) {
    return { ok: false, reason: "unparseable field_recall_date", raw };
  }

  const title = str(record.field_title) || sourceId;
  const firm = str(record.field_establishment);
  const summary = stripHtml(str(record.field_summary));
  const products = str(record.field_product_items);
  const productDesc = products || title;
  const reason = `${str(record.field_recall_reason)} ${summary}`.trim();
  const rawStatusParts = [str(record.field_recall_type), str(record.field_active_notice)]
    .filter(Boolean)
    .join(" / ");

  // FSIS lists affected states explicitly; fall back to scanning the summary
  // (public health alerts sometimes leave field_states empty).
  const listedStates = normalizeStateList(str(record.field_states).split(","));
  const states = listedStates.length > 0 ? listedStates : parseStatesFromText(summary);

  const enrichmentText = `${reason} ${productDesc}`;
  const allergens = extractAllergens(enrichmentText);
  const lifecycle = mapFsisLifecycle(
    str(record.field_active_notice),
    str(record.field_closed_date),
  );
  const classification = str(record.field_recall_classification);
  const productCodes = extractProductCodes(products);

  const pressRelease = str(record.field_press_release);
  const sourceUrl = pressRelease
    ? pressRelease.startsWith("http")
      ? pressRelease
      : `https://www.fsis.usda.gov${pressRelease.startsWith("/") ? "" : "/"}${pressRelease}`
    : "https://www.fsis.usda.gov/recalls";

  return {
    ok: true,
    record: {
      source: "fsis",
      sourceId,
      title,
      firm,
      classification,
      rawStatus: rawStatusParts,
      lifecycle,
      recallDate,
      productDesc,
      states,
      distribution: str(record.field_states),
      productCodes,
      allergens,
      audience: classifyAudience(productDesc, firm),
      hazardType: classifyHazard(reason, allergens),
      riskGroups: extractRiskGroups(`${summary} ${str(record.field_risk_level)}`),
      sourceUrl,
      raw,
      contentHash: computeContentHash({
        classification,
        rawStatus: rawStatusParts,
        lifecycle,
        states,
        allergens,
        productDesc,
        productCodes,
      }),
    },
  };
}
