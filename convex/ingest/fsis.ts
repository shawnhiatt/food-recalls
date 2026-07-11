import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { normalizeBatch } from "../adapters/types";
import { normalizeFsisRecord } from "../adapters/fsis";
import { summarize, upsertInChunks, type IngestSummary } from "./lib";

// USDA FSIS recall ingest (meat, poultry, egg products — near real-time, §3).
// The API returns the full recall list as one JSON array, so each run is a
// complete refresh; content hashes keep re-ingest idempotent.

const API_URL = "https://www.fsis.usda.gov/fsis/api/recall/v/1";

export const ingest = internalAction({
  args: {},
  handler: async (ctx): Promise<IngestSummary> => {
    try {
      const response = await fetch(API_URL, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`FSIS HTTP ${response.status}`);
      }
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) {
        throw new Error("FSIS response was not a JSON array");
      }

      const { records, skipped } = normalizeBatch(body, normalizeFsisRecord);
      if (skipped.length > 0) {
        console.warn(
          `[fsis] skipped ${skipped.length} malformed record(s): ` +
            skipped.map((s) => s.reason).join("; "),
        );
      }
      const counts = await upsertInChunks(ctx, records);
      const summary = summarize(body.length, skipped.length, counts);

      // The FSIS API always returns the historical list; an empty array where
      // records previously existed means the feed or parse broke (§10).
      const existingCount: number = await ctx.runQuery(internal.recalls.countBySource, {
        source: "fsis",
      });
      const anomaly = body.length === 0 && existingCount > 0;

      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fsis",
        outcome: "success",
        newRecords: summary.inserted,
        anomaly,
      });
      console.log(`[fsis] ingest: ${JSON.stringify(summary)}`);
      return summary;
    } catch (error) {
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fsis",
        outcome: "failure",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
