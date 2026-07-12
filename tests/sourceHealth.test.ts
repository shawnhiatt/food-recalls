import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import {
  computeHealthState,
  POLLING_INTERVALS_MS,
} from "../convex/sourceHealth";
import { setupConvex } from "./helpers";

// A current → degraded transition now schedules the §10 operator self-alert
// action; fake timers let us drain it so it can't leak a write past teardown.
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-11T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

// §10 state machine, simulated clocks (SPEC.md §14: "sourceHealth transitions
// verified by simulated failure").
describe("computeHealthState", () => {
  test("fresh success is current", () => {
    expect(
      computeHealthState({
        source: "fsis", now: NOW, lastSuccessAt: NOW - HOUR,
        consecutiveFailures: 0, anomaly: false,
      }),
    ).toBe("current");
  });

  test("delayed once last success exceeds 2x the polling interval", () => {
    const staleBy = 2 * POLLING_INTERVALS_MS.fsis + HOUR;
    expect(
      computeHealthState({
        source: "fsis", now: NOW, lastSuccessAt: NOW - staleBy,
        consecutiveFailures: 2, anomaly: false,
      }),
    ).toBe("delayed");
    // The same staleness is fine for a source polled daily.
    expect(
      computeHealthState({
        source: "fda", now: NOW, lastSuccessAt: NOW - staleBy,
        consecutiveFailures: 0, anomaly: false,
      }),
    ).toBe("current");
  });

  test("a successful-but-anomalous run is delayed", () => {
    expect(
      computeHealthState({
        source: "cdc", now: NOW, lastSuccessAt: NOW,
        consecutiveFailures: 0, anomaly: true,
      }),
    ).toBe("delayed");
  });

  test("unavailable at 5 consecutive failures", () => {
    expect(
      computeHealthState({
        source: "fda", now: NOW, lastSuccessAt: NOW - HOUR,
        consecutiveFailures: 5, anomaly: false,
      }),
    ).toBe("unavailable");
  });

  test("unavailable after 7 days without success", () => {
    expect(
      computeHealthState({
        source: "fda", now: NOW, lastSuccessAt: NOW - 8 * DAY,
        consecutiveFailures: 1, anomaly: false,
      }),
    ).toBe("unavailable");
  });

  test("never-succeeded source degrades by failure count only", () => {
    expect(
      computeHealthState({
        source: "cdc", now: NOW, lastSuccessAt: 0,
        consecutiveFailures: 0, anomaly: false,
      }),
    ).toBe("current");
    expect(
      computeHealthState({
        source: "cdc", now: NOW, lastSuccessAt: 0,
        consecutiveFailures: 1, anomaly: false,
      }),
    ).toBe("delayed");
  });
});

describe("reportRun mutation", () => {
  test("success creates a current record and tracks new-record time", async () => {
    const t = setupConvex();
    await t.mutation(internal.sourceHealth.reportRun, {
      source: "fsis", outcome: "success", newRecords: 3,
    });
    const all = await t.query(internal.sourceHealth.getAll, {});
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      source: "fsis", state: "current", consecutiveFailures: 0,
    });
    expect(all[0]!.lastNewRecordAt).toBeGreaterThan(0);
  });

  test("five simulated failures degrade the source to unavailable", async () => {
    const t = setupConvex();
    await t.mutation(internal.sourceHealth.reportRun, {
      source: "fda", outcome: "success", newRecords: 1,
    });

    let result;
    for (let i = 0; i < 5; i++) {
      result = await t.mutation(internal.sourceHealth.reportRun, {
        source: "fda", outcome: "failure", error: `HTTP 500 (run ${i + 1})`,
      });
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers); // drain operator alert
    expect(result).toMatchObject({ state: "unavailable" });

    const all = await t.query(internal.sourceHealth.getAll, {});
    expect(all[0]).toMatchObject({
      source: "fda",
      state: "unavailable",
      consecutiveFailures: 5,
      lastError: "HTTP 500 (run 5)",
    });
  });

  test("recovery resets to current", async () => {
    const t = setupConvex();
    for (let i = 0; i < 5; i++) {
      await t.mutation(internal.sourceHealth.reportRun, {
        source: "cdc", outcome: "failure", error: "parse error",
      });
    }
    const recovered = await t.mutation(internal.sourceHealth.reportRun, {
      source: "cdc", outcome: "success", newRecords: 0,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers); // drain operator alert
    expect(recovered).toMatchObject({ state: "current", previousState: "unavailable" });
  });

  test("anomalous success (zero records where data existed) reports delayed", async () => {
    const t = setupConvex();
    const result = await t.mutation(internal.sourceHealth.reportRun, {
      source: "fda_rss", outcome: "success", newRecords: 0, anomaly: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers); // drain operator alert
    expect(result).toMatchObject({ state: "delayed" });
  });
});
