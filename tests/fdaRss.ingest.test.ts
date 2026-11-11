import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { setupConvex } from "./helpers";
import {
  BLUEBERRY_PAGE,
  NOW,
  OFF_IMAGE,
  PENDING_PRESS,
  RSS_URL,
  getHealth,
  insertPendingPress,
  insertRecall,
  seedUnavailableHealth,
  stubFetch,
} from "./fdaRssIngest.helpers";

// FDA press ingest action (convex/ingest/fdaRss.ts, T1 of the 2026-11 health
// audit). The run is three isolated steps: feed (+ press pages), relink, and
// the Open Food Facts image fallback. A feed failure must not skip the other
// two, and only the feed step may move `fda_rss` health (§10): relink or OFF
// succeeding while fda.gov is unreachable must never reopen the reassurance
// gate. The relink-failure case lives in fdaRss.ingest.relinkFailure.test.ts
// because it needs a module mock.

// Fake only Date: the action awaits real promises inside convex-test.
beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DAY = 24 * 60 * 60 * 1000;

describe("fdaRss ingest action", () => {
  test("happy path: feed, press page, relink and OFF all run; fda_rss reports current", async () => {
    const t = setupConvex();
    const fetchMock = stubFetch({ fdaGov: "ok" });
    const blueberries = await insertRecall(t, {
      firm: "Frutas y Hortalizas del Sur SA",
      recallDate: "2026-07-01",
    });
    const baba = await insertRecall(t, { firm: "Riad's Oliva to Go", recallDate: "2026-07-06" });
    const withUpc = await insertRecall(t, {
      firm: "Unrelated Snacks LLC",
      recallDate: "2026-07-02",
      productCodes: ["012345678905"],
    });
    await insertPendingPress(t);

    const summary = await t.action(internal.ingest.fdaRss.ingest, {});

    expect(summary).toEqual({
      feedItems: 3, // 4 in the fixture; the link-less one is skipped
      pagesFetched: 1, // the stub 404s the other pages; they retry next run
      recallsEnriched: 1,
      relinked: 1,
      offImages: 1,
      failedSteps: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(RSS_URL, expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(BLUEBERRY_PAGE, expect.anything());

    const [b, o, u] = await t.run((ctx) =>
      Promise.all([ctx.db.get(blueberries), ctx.db.get(baba), ctx.db.get(withUpc)]),
    );
    expect(b!.imageSource).toBe("press");
    expect(o!.imageUrl).toBe(PENDING_PRESS.imageUrl);
    expect(u!.imageUrl).toBe(OFF_IMAGE);
    expect(u!.imageSource).toBe("openfoodfacts");

    const health = await getHealth(t);
    expect(health!.state).toBe("current");
    expect(health!.consecutiveFailures).toBe(0);
    expect(health!.lastSuccessAt).toBe(NOW.getTime());
  });

  test("feed 401: relink and OFF still run, and fda_rss records the failure", async () => {
    const t = setupConvex();
    const fetchMock = stubFetch({ fdaGov: "401" });
    const lastSuccessAt = NOW.getTime() - 18 * DAY;
    await seedUnavailableHealth(t, lastSuccessAt);
    // The Oliva case: press item already in the DB, openFDA record landed later.
    const baba = await insertRecall(t, { firm: "Riad's Oliva to Go", recallDate: "2026-07-06" });
    const withUpc = await insertRecall(t, {
      firm: "Unrelated Snacks LLC",
      recallDate: "2026-07-02",
      productCodes: ["012345678905"],
    });
    await insertPendingPress(t);

    // The run still fails loudly (cron log, dashboard), but only after every
    // step has had its turn.
    await expect(t.action(internal.ingest.fdaRss.ingest, {})).rejects.toThrow(
      `feed: HTTP 401 for ${RSS_URL}`,
    );
    // fda.gov was tried once (the feed), then never again this run.
    const fdaCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("fda.gov"));
    expect(fdaCalls).toHaveLength(1);

    // Relink joined the stored press item to the later openFDA record.
    const o = await t.run((ctx) => ctx.db.get(baba));
    expect(o!.imageUrl).toBe(PENDING_PRESS.imageUrl);
    expect(o!.riskGroups).toEqual(PENDING_PRESS.riskGroups);
    expect(o!.sourceUrl).toBe(PENDING_PRESS.url); // the notice, not raw API JSON
    const press = await t.run((ctx) => ctx.db.query("pressItems").first());
    expect(press!.matchedRecallIds).toEqual([baba]);

    // OFF ran too.
    const u = await t.run((ctx) => ctx.db.get(withUpc));
    expect(u!.imageUrl).toBe(OFF_IMAGE);

    // §10: relink/OFF succeeding did not mark the source current.
    const health = await getHealth(t);
    expect(health!.state).toBe("unavailable");
    expect(health!.consecutiveFailures).toBe(146);
    expect(health!.lastSuccessAt).toBe(lastSuccessAt);
    expect(health!.lastError).toBe(`HTTP 401 for ${RSS_URL}`);
    expect(health!.lastAttemptAt).toBe(NOW.getTime());
  });

  test("feed 401 on a fresh deployment: first failure degrades fda_rss", async () => {
    const t = setupConvex();
    stubFetch({ fdaGov: "401" });

    await expect(t.action(internal.ingest.fdaRss.ingest, {})).rejects.toThrow(/^feed: HTTP 401/);

    const health = await getHealth(t);
    expect(health!.state).toBe("delayed");
    expect(health!.consecutiveFailures).toBe(1);
    expect(health!.lastSuccessAt).toBe(0);
  });
});
