import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Data-health contract (SPEC.md §10). Every adapter run — success, empty, or
// failure — reports here. The stored state gates all reassurance copy from
// Phase 1 on: "you're all clear" is only permitted when every enabled source
// is Current.

export type Source = "fda" | "fsis" | "fda_rss" | "cdc";
export type HealthState = "current" | "delayed" | "unavailable";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Polling interval per source (§3/§4); health thresholds derive from these. */
export const POLLING_INTERVALS_MS: Record<Source, number> = {
  fda: 24 * HOUR, // openFDA ingest runs daily
  fsis: 3 * HOUR,
  fda_rss: 3 * HOUR, // Phase 1
  cdc: 3 * HOUR, // Phase 4
};

/**
 * §10 state machine, pure so it can be tested with simulated clocks:
 *  - unavailable: no success in 7+ days, or 5+ consecutive failures
 *  - delayed: last success older than 2× polling interval, or an anomalous run
 *  - current: otherwise
 */
export function computeHealthState(params: {
  source: Source;
  now: number;
  lastSuccessAt: number; // 0 = never succeeded
  consecutiveFailures: number;
  anomaly: boolean;
}): HealthState {
  const { source, now, lastSuccessAt, consecutiveFailures, anomaly } = params;
  if (consecutiveFailures >= 5) return "unavailable";
  if (lastSuccessAt === 0) {
    // Never succeeded: degrade by failure count only until the first success.
    return consecutiveFailures > 0 ? "delayed" : "current";
  }
  const sinceSuccess = now - lastSuccessAt;
  if (sinceSuccess > 7 * DAY) return "unavailable";
  if (sinceSuccess > 2 * POLLING_INTERVALS_MS[source]) return "delayed";
  if (anomaly) return "delayed";
  return "current";
}

const sourceValidator = v.union(
  v.literal("fda"),
  v.literal("fsis"),
  v.literal("fda_rss"),
  v.literal("cdc"),
);

export const reportRun = internalMutation({
  args: {
    source: sourceValidator,
    outcome: v.union(v.literal("success"), v.literal("failure")),
    error: v.optional(v.string()),
    newRecords: v.optional(v.number()),
    // True when the run "succeeded" suspiciously, e.g. a parse returned zero
    // records where records previously existed (§10, §15 scraper fragility).
    anomaly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("sourceHealth")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .unique();

    const previousState = existing?.state ?? "current";
    const success = args.outcome === "success";

    const lastSuccessAt = success ? now : (existing?.lastSuccessAt ?? 0);
    const consecutiveFailures = success ? 0 : (existing?.consecutiveFailures ?? 0) + 1;

    const state = computeHealthState({
      source: args.source,
      now,
      lastSuccessAt,
      consecutiveFailures,
      anomaly: args.anomaly ?? false,
    });

    const patch = {
      source: args.source,
      state,
      lastAttemptAt: now,
      lastSuccessAt,
      consecutiveFailures,
      lastError: success ? existing?.lastError : args.error ?? "unknown error",
      lastNewRecordAt:
        success && (args.newRecords ?? 0) > 0 ? now : existing?.lastNewRecordAt,
    };

    if (existing === null) {
      await ctx.db.insert("sourceHealth", patch);
    } else {
      await ctx.db.patch(existing._id, patch);
    }

    // Self-alert on degradation (§10). Phase 0 logs; Phase 2 adds the operator
    // email via Resend when email infrastructure lands.
    if (state !== "current" && previousState === "current") {
      console.warn(
        `[sourceHealth] ${args.source} degraded: ${previousState} -> ${state}` +
          (args.error ? ` (${args.error})` : ""),
      );
    }

    return { state, previousState };
  },
});

export const getAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("sourceHealth").collect();
  },
});
