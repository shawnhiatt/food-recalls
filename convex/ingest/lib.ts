import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { NormalizedRecall } from "../adapters/types";
import type { UpsertCounts } from "../recalls";

// Shared ingest plumbing: chunked upserts (keeps each mutation small) and a
// uniform run summary shape for logging + health reporting.

export type IngestSummary = UpsertCounts & {
  fetched: number;
  skipped: number;
};

const UPSERT_CHUNK_SIZE = 100;

export async function upsertInChunks(
  ctx: ActionCtx,
  records: NormalizedRecall[],
): Promise<UpsertCounts> {
  const totals: UpsertCounts = { inserted: 0, materialUpdates: 0, touched: 0 };
  for (let i = 0; i < records.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = records.slice(i, i + UPSERT_CHUNK_SIZE);
    const counts: UpsertCounts = await ctx.runMutation(
      internal.recalls.upsertBatch,
      { records: chunk },
    );
    totals.inserted += counts.inserted;
    totals.materialUpdates += counts.materialUpdates;
    totals.touched += counts.touched;
  }
  return totals;
}

export function summarize(
  fetched: number,
  skipped: number,
  counts: UpsertCounts,
): IngestSummary {
  return { fetched, skipped, ...counts };
}
