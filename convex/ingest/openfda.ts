import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { normalizeBatch } from "../adapters/types";
import { normalizeOpenFdaRecord } from "../adapters/openfda";
import { summarize, upsertInChunks, type IngestSummary } from "./lib";

// openFDA Food Enforcement ingest (SPEC.md §3/§4).
//  - ingestRecent: daily cron; re-fetches a trailing window because openFDA
//    mutates old records in place (§15) — content hashes decide materiality.
//  - backfill: initial history load, paged 1000/call and chunked through the
//    scheduler to respect action time limits and stay polite (§4 Backfill).

const BASE_URL = "https://api.fda.gov/food/enforcement.json";
const PAGE_LIMIT = 1000; // openFDA maximum per call (§15)
const RECENT_WINDOW_DAYS = 90;
const BACKFILL_FIRST_YEAR = 2004; // openFDA enforcement data begins mid-2004
const PAGE_DELAY_MS = 2000;

function apiUrl(search: string, skip: number): string {
  const params = new URLSearchParams();
  params.set("search", search);
  params.set("limit", String(PAGE_LIMIT));
  if (skip > 0) params.set("skip", String(skip));
  const key = process.env.OPENFDA_API_KEY;
  if (key) params.set("api_key", key);
  // openFDA expects its range syntax un-encoded in `search`.
  return `${BASE_URL}?${params.toString().replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/%2B/g, "+")}`;
}

const yyyymmdd = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "");

/**
 * Fetch one page. openFDA answers 404 with a NOT_FOUND body when a search
 * matches nothing — that is "no results", not an error.
 */
async function fetchPage(search: string, skip: number): Promise<unknown[]> {
  const response = await fetch(apiUrl(search, skip));
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`openFDA HTTP ${response.status}: ${await response.text().then((t) => t.slice(0, 200))}`);
  }
  const body = (await response.json()) as { results?: unknown[] };
  return body.results ?? [];
}

async function ingestPage(
  ctx: ActionCtx,
  search: string,
  skip: number,
): Promise<{ summary: IngestSummary; fullPage: boolean }> {
  const results = await fetchPage(search, skip);
  const { records, skipped } = normalizeBatch(results, normalizeOpenFdaRecord);
  if (skipped.length > 0) {
    console.warn(
      `[openfda] skipped ${skipped.length} malformed record(s): ` +
        skipped.map((s) => s.reason).join("; "),
    );
  }
  const counts = await upsertInChunks(ctx, records);
  return {
    summary: summarize(results.length, skipped.length, counts),
    fullPage: results.length === PAGE_LIMIT,
  };
}

export const ingestRecent = internalAction({
  args: {},
  handler: async (ctx): Promise<IngestSummary> => {
    const end = new Date();
    const start = new Date(end.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const search = `report_date:[${yyyymmdd(start)}+TO+${yyyymmdd(end)}]`;

    try {
      const totals: IngestSummary = {
        fetched: 0, skipped: 0, inserted: 0, materialUpdates: 0, touched: 0,
      };
      let skip = 0;
      for (;;) {
        const { summary, fullPage } = await ingestPage(ctx, search, skip);
        totals.fetched += summary.fetched;
        totals.skipped += summary.skipped;
        totals.inserted += summary.inserted;
        totals.materialUpdates += summary.materialUpdates;
        totals.touched += summary.touched;
        if (!fullPage) break;
        skip += PAGE_LIMIT;
      }

      // Zero records in a 90-day window when the table already has FDA data is
      // a parse/feed anomaly, not a quiet news week (§10 "Delayed").
      const existingCount: number = await ctx.runQuery(internal.recalls.countBySource, {
        source: "fda",
      });
      const anomaly = totals.fetched === 0 && existingCount > 0;

      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda",
        outcome: "success",
        newRecords: totals.inserted,
        anomaly,
      });
      console.log(`[openfda] ingestRecent: ${JSON.stringify(totals)}`);
      return totals;
    } catch (error) {
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda",
        outcome: "failure",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

/** Kick off the full history backfill: one scheduled page-run per step. */
export const backfill = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.ingest.openfda.backfillPage, {
      year: BACKFILL_FIRST_YEAR,
      skip: 0,
    });
    console.log(`[openfda] backfill scheduled from ${BACKFILL_FIRST_YEAR}`);
  },
});

/**
 * One backfill step: fetch a page within a single report_date year (keeps every
 * search's result count far below openFDA's 25k skip ceiling), then schedule
 * the next page or the next year.
 */
export const backfillPage = internalAction({
  args: { year: v.number(), skip: v.number() },
  handler: async (ctx, args) => {
    const currentYear = new Date().getUTCFullYear();
    const search = `report_date:[${args.year}0101+TO+${args.year}1231]`;

    try {
      const { summary, fullPage } = await ingestPage(ctx, search, args.skip);
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda",
        outcome: "success",
        newRecords: summary.inserted,
      });
      console.log(
        `[openfda] backfill ${args.year} skip=${args.skip}: ${JSON.stringify(summary)}`,
      );

      if (fullPage) {
        await ctx.scheduler.runAfter(PAGE_DELAY_MS, internal.ingest.openfda.backfillPage, {
          year: args.year,
          skip: args.skip + PAGE_LIMIT,
        });
      } else if (args.year < currentYear) {
        await ctx.scheduler.runAfter(PAGE_DELAY_MS, internal.ingest.openfda.backfillPage, {
          year: args.year + 1,
          skip: 0,
        });
      } else {
        console.log("[openfda] backfill complete");
      }
    } catch (error) {
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda",
        outcome: "failure",
        error: error instanceof Error ? error.message : String(error),
      });
      // Leave resumption to the operator (or the next cron run for recent
      // data); auto-retry loops against a rate limit would be impolite.
      console.error(`[openfda] backfill failed at ${args.year} skip=${args.skip}`);
      throw error;
    }
  },
});
