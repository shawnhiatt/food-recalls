import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { setupConvex } from "./helpers";
import {
  BLUEBERRY_PAGE,
  NOW,
  RSS_URL,
  getHealth,
  insertPendingPress,
  insertRecall,
  seedUnavailableHealth,
  stubFetch,
} from "./fdaRssIngest.helpers";
import rssXml from "./fixtures/fda_rss/recalls-rss.xml?raw";
import pressHtml from "./fixtures/fda_rss/press-page.html?raw";

// FDA press relay HTTP action (convex/ingest/fdaRelay.ts, T5 of the 2026-11
// health audit). fda.gov denies Convex's egress, so an off-Convex relay POSTs
// the feed and press pages here. Auth and body problems must never move
// `fda_rss` health; a real relay feed must, and Convex's own failing fetch must
// stop counting while the relay is current, but only while it is (§10).

const SECRET = "test-relay-secret";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Date and setTimeout are faked: setTimeout so each test can drain the
// operator alert that a degraded edge schedules (finishAllScheduledFunctions).
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout"] });
  vi.stubEnv("FDA_RELAY_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof setupConvex>;

const post = (t: T, body: unknown, secret: string | null = SECRET) =>
  t.fetch("/relay/fda-rss", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { Authorization: `Bearer ${secret}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const drain = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

const pressCount = (t: T) => t.run(async (ctx) => (await ctx.db.query("pressItems").collect()).length);

describe("fda_rss relay: auth", () => {
  test("unset secret: 503, and nothing recorded", async () => {
    vi.stubEnv("FDA_RELAY_SECRET", "");
    const t = setupConvex();
    const response = await post(t, { step: "feed", rss: rssXml });
    expect(response.status).toBe(503);
    expect(await getHealth(t)).toBeNull();
  });

  test("wrong or missing secret: 401, and health untouched", async () => {
    const t = setupConvex();
    await seedUnavailableHealth(t, NOW.getTime() - 18 * DAY);
    for (const secret of ["wrong-secret", "", null, `${SECRET}x`]) {
      const response = await post(t, { step: "feed", rss: rssXml }, secret);
      expect(response.status).toBe(401);
    }
    // A non-Bearer scheme with the right value is still refused.
    const basic = await t.fetch("/relay/fda-rss", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: JSON.stringify({ step: "feed", rss: rssXml }),
    });
    expect(basic.status).toBe(401);

    const health = await getHealth(t);
    expect(health!.state).toBe("unavailable");
    expect(health!.consecutiveFailures).toBe(145);
    expect(await pressCount(t)).toBe(0);
  });
});

describe("fda_rss relay: malformed bodies", () => {
  test.each([
    ["not JSON", "<rss>oops"],
    ["JSON null", "null"],
    ["unknown step", { step: "delete", rss: rssXml }],
    ["feed without rss", { step: "feed" }],
    ["feed rss not a string", { step: "feed", rss: 42 }],
    ["failure without error", { step: "failure" }],
    ["page without html", { step: "page", item: { guid: "g", url: BLUEBERRY_PAGE, title: "t", publishedAt: "2026-07-03" } }],
    ["page without item", { step: "page", html: pressHtml }],
    ["page off fda.gov", { step: "page", html: pressHtml, item: { guid: "g", url: "https://evil.example/x", title: "t", publishedAt: "2026-07-03" } }],
  ])("%s: 400, and health untouched", async (_label, body) => {
    const t = setupConvex();
    await seedUnavailableHealth(t, NOW.getTime() - 18 * DAY);
    const response = await post(t, body);
    expect(response.status).toBe(400);
    const health = await getHealth(t);
    expect(health!.consecutiveFailures).toBe(145);
    expect(health!.state).toBe("unavailable");
    expect(await pressCount(t)).toBe(0);
  });

  test("an oversized body is refused with 413", async () => {
    const t = setupConvex();
    const response = await post(t, { step: "feed", rss: "x".repeat(2_100_000) });
    expect(response.status).toBe(413);
    expect(await getHealth(t)).toBeNull();
  });
});

describe("fda_rss relay: happy path", () => {
  test("feed then page: health goes current, the press item lands and enriches its recall", async () => {
    const t = setupConvex();
    await seedUnavailableHealth(t, NOW.getTime() - 18 * DAY);
    const blueberries = await insertRecall(t, {
      firm: "Frutas y Hortalizas del Sur SA",
      recallDate: "2026-07-01",
    });

    const feed = await post(t, { step: "feed", rss: rssXml });
    expect(feed.status).toBe(200);
    const plan = await feed.json();
    expect(plan.feedItems).toBe(3); // the link-less fixture item is skipped
    expect(plan.anomaly).toBe(false);
    expect(plan.state).toBe("current");
    expect(plan.pages).toHaveLength(3);
    const item = plan.pages.find((p: { url: string }) => p.url === BLUEBERRY_PAGE);
    expect(item).toMatchObject({ guid: BLUEBERRY_PAGE, publishedAt: "2026-07-03" });

    // §10: the relay's success is a real feed observation.
    let health = await getHealth(t);
    expect(health!.state).toBe("current");
    expect(health!.consecutiveFailures).toBe(0);
    expect(health!.lastSuccessAt).toBe(NOW.getTime());
    expect(health!.relayLastSuccessAt).toBe(NOW.getTime());
    expect(health!.directLastSuccessAt).toBeUndefined();

    const page = await post(t, { step: "page", item, html: pressHtml });
    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({ matched: 1 });

    const recall = await t.run((ctx) => ctx.db.get(blueberries));
    expect(recall!.imageSource).toBe("press");
    expect(recall!.sourceUrl).toBe(BLUEBERRY_PAGE);
    const press = await t.run((ctx) =>
      ctx.db
        .query("pressItems")
        .withIndex("by_guid", (q) => q.eq("guid", BLUEBERRY_PAGE))
        .unique(),
    );
    expect(press!.matchedRecallIds).toEqual([blueberries]);
    expect(press!.relevant).toBe(true);

    // The next feed POST no longer asks for the recorded page.
    const again = await (await post(t, { step: "feed", rss: rssXml })).json();
    expect(again.pages.map((p: { url: string }) => p.url)).not.toContain(BLUEBERRY_PAGE);
    expect(again.pages).toHaveLength(2);
    health = await getHealth(t);
    expect(health!.state).toBe("current");
  });

  test("a zero-item feed after items existed is an anomaly: delayed, not current", async () => {
    const t = setupConvex();
    await insertPendingPress(t);
    const response = await post(t, {
      step: "feed",
      rss: '<?xml version="1.0"?><rss><channel></channel></rss>',
    });
    const plan = await response.json();
    await drain(t); // operator alert for current → delayed
    expect(plan.anomaly).toBe(true);
    expect(plan.pages).toEqual([]);
    expect((await getHealth(t))!.state).toBe("delayed");
  });

  test("a relay-reported failure counts against fda_rss", async () => {
    const t = setupConvex();
    const response = await post(t, { step: "failure", error: `HTTP 401 for ${RSS_URL}` });
    await drain(t); // operator alert for current → delayed
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "delayed", counted: true });
    const health = await getHealth(t);
    expect(health!.consecutiveFailures).toBe(1);
    expect(health!.lastError).toBe(`relay: HTTP 401 for ${RSS_URL}`);
  });
});

describe("fda_rss with two transports (§10)", () => {
  test("Convex's own 401 isn't counted while the relay is current; relink still runs", async () => {
    const t = setupConvex();
    await seedUnavailableHealth(t, NOW.getTime() - 18 * DAY);
    await post(t, { step: "feed", rss: rssXml });

    vi.setSystemTime(NOW.getTime() + 3 * HOUR);
    stubFetch({ fdaGov: "401" });
    const baba = await insertRecall(t, { firm: "Riad's Oliva to Go", recallDate: "2026-07-06" });
    await insertPendingPress(t);

    const summary = await t.action(internal.ingest.fdaRss.ingest, {}); // doesn't throw
    expect(summary.failedSteps).toEqual([]);
    expect(summary.relinked).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(baba)))!.imageSource).toBe("press");

    const health = await getHealth(t);
    expect(health!.state).toBe("current");
    expect(health!.consecutiveFailures).toBe(0);
    expect(health!.lastSuccessAt).toBe(NOW.getTime());
  });

  test("once the relay goes quiet past the delayed threshold, Convex's failures count again", async () => {
    const t = setupConvex();
    await post(t, { step: "feed", rss: rssXml });

    // 2× the 3h polling interval with no relay success: the relay no longer covers.
    vi.setSystemTime(NOW.getTime() + 7 * HOUR);
    stubFetch({ fdaGov: "401" });
    await expect(t.action(internal.ingest.fdaRss.ingest, {})).rejects.toThrow(/^feed: HTTP 401/);
    await drain(t); // operator alert for current → delayed

    const health = await getHealth(t);
    expect(health!.state).toBe("delayed");
    expect(health!.consecutiveFailures).toBe(1);
    expect(health!.lastError).toBe(`HTTP 401 for ${RSS_URL}`);
  });

  test("symmetric: a relay failure isn't counted while Convex's own fetch is current", async () => {
    const t = setupConvex();
    stubFetch({ fdaGov: "ok" }); // fda.gov unblocked Convex again
    await t.action(internal.ingest.fdaRss.ingest, {});
    expect((await getHealth(t))!.directLastSuccessAt).toBe(NOW.getTime());

    vi.setSystemTime(NOW.getTime() + HOUR);
    const response = await post(t, { step: "failure", error: "fetch failed" });
    expect(await response.json()).toEqual({ state: "current", counted: false });
    const health = await getHealth(t);
    expect(health!.consecutiveFailures).toBe(0);
    expect(health!.lastError).toBeUndefined();
  });
});
