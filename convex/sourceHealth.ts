import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

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

    // Self-alert on degradation (§10): log AND operator email. Only fires on the
    // current → degraded edge, so a source that stays degraded doesn't re-nag.
    if (state !== "current" && previousState === "current") {
      console.warn(
        `[sourceHealth] ${args.source} degraded: ${previousState} -> ${state}` +
          (args.error ? ` (${args.error})` : ""),
      );
      await ctx.scheduler.runAfter(0, internal.notifications.sendOperatorAlert, {
        source: args.source,
        previousState,
        state,
        error: args.error,
      });
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

const STATE_RANK: Record<HealthState, number> = {
  current: 0,
  delayed: 1,
  unavailable: 2,
};

/**
 * Public, sanitized status for the feed banner and status pill (§10). Omits
 * `lastError`/`consecutiveFailures` — operator-only detail, not sensitive but
 * not something the UI needs either. `allCurrent` drives the reassurance
 * gate: "you're all clear" copy is only permitted when every source is
 * Current.
 *
 * The stored state is only rewritten when a run reports. If the scheduler
 * stops firing entirely (paused deployment, broken cron), nothing ever
 * rewrites it — so staleness is recomputed here at read time and the worse
 * of stored vs. time-based wins. The reassurance gate must fail closed, not
 * stay green on a dead scheduler.
 */
export const getPublicStatus = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db.query("sourceHealth").collect();
    const sources = all.map((s) => {
      const timeBased = computeHealthState({
        source: s.source,
        now,
        lastSuccessAt: s.lastSuccessAt,
        consecutiveFailures: s.consecutiveFailures,
        anomaly: false,
      });
      return {
        source: s.source,
        state: STATE_RANK[timeBased] > STATE_RANK[s.state] ? timeBased : s.state,
        lastSuccessAt: s.lastSuccessAt,
      };
    });
    return {
      sources,
      allCurrent: sources.length > 0 && sources.every((s) => s.state === "current"),
    };
  },
});
