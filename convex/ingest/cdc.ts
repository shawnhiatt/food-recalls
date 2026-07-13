import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  isFoodbornePathogenTitle,
  normalizeOutbreak,
  parseOutbreakDetailPage,
  parseOutbreakListItems,
  type CdcListItem,
  type NormalizedOutbreak,
} from "../adapters/cdc";

// CDC outbreak investigations ingest (SPEC.md §3/§4 — Phase 4). Every 3h:
// fetch the "Current Outbreak List" landing page, keep only foodborne/
// zoonotic-enteric pathogen entries, then re-fetch EVERY qualifying
// investigation's own detail page and upsert.
//
// Unlike the FDA press adapter's write-once guid cache, this re-fetches
// already-known outbreaks every run rather than skipping them: CDC's list
// only ever holds a handful of current investigations at a time (§3 "no
// clean structured API"), so the cost is small, and re-fetching is exactly
// what surfaces an Open→Closed transition or an updated case count —
// there's no other signal that would tell us to revisit a specific one.

const LIST_URL = "https://www.cdc.gov/outbreaks/index.html";

// cdc.gov sits behind bot detection that answers 403 to a plain/identifying
// User-Agent (verified 2026-07-13, same symptom as FSIS's Akamai block —
// see convex/ingest/fsis.ts). A full browser-like header set gets through.
const HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

// Generous headroom over the real page's current handful of foodborne
// listings — a spike here is a signal worth seeing in logs, not silently
// truncating.
const MAX_DETAIL_FETCHES_PER_RUN = 25;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

/** Fetch + parse one investigation's detail page; null (with a log) on failure. */
async function ingestOne(item: CdcListItem): Promise<NormalizedOutbreak | null> {
  try {
    const html = await fetchText(item.url);
    return normalizeOutbreak(item, parseOutbreakDetailPage(html));
  } catch (error) {
    console.warn(
      `[cdc] detail page failed, will retry next run: ${item.url} — ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}

export type CdcIngestSummary = {
  listItems: number;
  foodborneItems: number;
  detailFetches: number;
  detailFailures: number;
  inserted: number;
  materialUpdates: number;
  touched: number;
};

export const ingest = internalAction({
  args: {},
  handler: async (ctx): Promise<CdcIngestSummary> => {
    try {
      const html = await fetchText(LIST_URL);
      const items = parseOutbreakListItems(html);
      const foodborne = items.filter((item) => isFoodbornePathogenTitle(item.title));

      // Zero items from a page that has produced items before is a markup/
      // parse anomaly, not a quiet outbreak week (§10, §15 scraper fragility).
      const hadOutbreaks: boolean = await ctx.runQuery(internal.outbreaks.hasAny, {});
      const anomaly = items.length === 0 && hadOutbreaks;

      const toFetch = foodborne.slice(0, MAX_DETAIL_FETCHES_PER_RUN);
      const records: NormalizedOutbreak[] = [];
      let detailFailures = 0;
      for (const item of toFetch) {
        const normalized = await ingestOne(item);
        if (normalized === null) {
          detailFailures++;
          continue;
        }
        records.push(normalized);
      }

      const counts =
        records.length > 0
          ? await ctx.runMutation(internal.outbreaks.upsertBatch, { records })
          : { inserted: 0, materialUpdates: 0, touched: 0 };

      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "cdc",
        outcome: "success",
        newRecords: counts.inserted,
        anomaly,
      });

      const summary: CdcIngestSummary = {
        listItems: items.length,
        foodborneItems: foodborne.length,
        detailFetches: records.length,
        detailFailures,
        ...counts,
      };
      console.log(`[cdc] ingest: ${JSON.stringify(summary)}`);
      return summary;
    } catch (error) {
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "cdc",
        outcome: "failure",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
