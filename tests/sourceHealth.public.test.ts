import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setupConvex } from "./helpers";

// Public source-status summary (SPEC.md §10): drives the feed banner and the
// reassurance gate. `allCurrent` must be false whenever any enabled source is
// degraded, and false (not vacuously true) before any source has reported.

describe("sourceHealth.getPublicStatus", () => {
  test("allCurrent is false before any source has reported", async () => {
    const t = setupConvex();
    const status = await t.query(api.sourceHealth.getPublicStatus, {});
    expect(status).toEqual({ sources: [], allCurrent: false });
  });

  test("allCurrent is true only when every reporting source is current", async () => {
    const t = setupConvex();
    await t.mutation(internal.sourceHealth.reportRun, { source: "fda", outcome: "success" });
    await t.mutation(internal.sourceHealth.reportRun, { source: "fsis", outcome: "success" });

    let status = await t.query(api.sourceHealth.getPublicStatus, {});
    expect(status.allCurrent).toBe(true);
    expect(status.sources.map((s) => s.source).sort()).toEqual(["fda", "fsis"]);

    // A single recent failure doesn't degrade state (§10 only degrades on 5+
    // consecutive failures or enough elapsed time) — drive it to unavailable.
    for (let i = 0; i < 5; i++) {
      await t.mutation(internal.sourceHealth.reportRun, {
        source: "fsis",
        outcome: "failure",
        error: "timeout",
      });
    }
    status = await t.query(api.sourceHealth.getPublicStatus, {});
    expect(status.allCurrent).toBe(false);

    // Sanitized: no lastError/consecutiveFailures leak into the public shape.
    for (const source of status.sources) {
      expect(source).not.toHaveProperty("lastError");
      expect(source).not.toHaveProperty("consecutiveFailures");
    }
  });
});
