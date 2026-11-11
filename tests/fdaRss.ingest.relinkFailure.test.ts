import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { setupConvex } from "./helpers";
import { NOW, OFF_IMAGE, getHealth, insertRecall, stubFetch } from "./fdaRssIngest.helpers";

// Relink throws → the OFF fallback still runs, and the relink failure does
// not flip `fda_rss` health: the feed step is the only one that reports (§10).
// Lives in its own file because the module mock replaces convex/press.ts for
// every test in the file.

vi.mock("../convex/press", async (importOriginal) => {
  const original = await importOriginal<typeof import("../convex/press")>();
  const { internalMutation } = await import("../convex/_generated/server");
  const { v } = await import("convex/values");
  return {
    ...original,
    relinkUnmatched: internalMutation({
      args: { now: v.optional(v.number()) },
      handler: async (): Promise<{ relinked: number }> => {
        throw new Error("relink exploded");
      },
    }),
  };
});

beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("relink throws: OFF still runs and fda_rss stays current", async () => {
  const t = setupConvex();
  stubFetch({ fdaGov: "ok" });
  const withUpc = await insertRecall(t, {
    firm: "Unrelated Snacks LLC",
    recallDate: "2026-07-02",
    productCodes: ["012345678905"],
  });

  await expect(t.action(internal.ingest.fdaRss.ingest, {})).rejects.toThrow(
    /^relink: .*relink exploded/,
  );

  const u = await t.run((ctx) => ctx.db.get(withUpc));
  expect(u!.imageUrl).toBe(OFF_IMAGE);
  expect(u!.imageSource).toBe("openfoodfacts");

  // The feed succeeded, so the source is current; relink's failure is logged
  // and fails the run, but isn't a coverage gap.
  const health = await getHealth(t);
  expect(health!.state).toBe("current");
  expect(health!.consecutiveFailures).toBe(0);
  // Feed step still recorded its press item.
  const pressCount = await t.run(async (ctx) => (await ctx.db.query("pressItems").collect()).length);
  expect(pressCount).toBe(1);
});
