import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runRelay } from "../scripts/fda-relay.mjs";
import { setupConvex } from "./helpers";
import {
  BLUEBERRY_PAGE,
  NOW,
  RSS_URL,
  getHealth,
  insertRecall,
  seedUnavailableHealth,
} from "./fdaRssIngest.helpers";
import rssXml from "./fixtures/fda_rss/recalls-rss.xml?raw";
import pressHtml from "./fixtures/fda_rss/press-page.html?raw";

// The relay client (scripts/fda-relay.mjs) end to end against the Convex HTTP
// action: fda.gov is served from fixtures, and Convex is convex-test's t.fetch.
// This is the path the backfill run takes, so it checks the before/after the
// ticket reports: fda_rss unavailable → current, press items added, recalls
// enriched.

const SECRET = "test-relay-secret";
const RELAY_URL = "https://test.convex.site/relay/fda-rss";
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("FDA_RELAY_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof setupConvex>;

function relayFetch(t: T, fdaGov: "ok" | "401") {
  return vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === RELAY_URL) return await t.fetch("/relay/fda-rss", init);
    if (fdaGov === "401") return new Response("Sorry! This resembles an automated request.", { status: 401 });
    if (input === RSS_URL) return new Response(rssXml, { status: 200 });
    if (input === BLUEBERRY_PAGE) return new Response(pressHtml, { status: 200 });
    return new Response("not found", { status: 404 });
  });
}

describe("relay client", () => {
  test("backfill: relays the feed and every new page; health recovers", async () => {
    const t = setupConvex();
    await seedUnavailableHealth(t, NOW.getTime() - 18 * DAY);
    const blueberries = await insertRecall(t, {
      firm: "Frutas y Hortalizas del Sur SA",
      recallDate: "2026-07-01",
    });
    const fetchImpl = relayFetch(t, "ok");

    const summary = await runRelay({ relayUrl: RELAY_URL, secret: SECRET, fetchImpl, log: () => {}, pauseMs: 0 });

    expect(summary).toEqual({
      ok: true,
      state: "current",
      feedItems: 3,
      newPages: 3,
      recorded: 1, // the other two fixture pages 404 and are asked for again next run
      recallsEnriched: 1,
      failedPages: expect.arrayContaining([expect.stringContaining("faysu")]),
    });
    expect((await t.run((ctx) => ctx.db.get(blueberries)))!.imageSource).toBe("press");
    const health = await getHealth(t);
    expect(health!.state).toBe("current");
    expect(health!.consecutiveFailures).toBe(0);
    // The app's UA, sent to fda.gov; the secret only ever goes to the relay URL.
    const rssCall = fetchImpl.mock.calls.find(([url]) => url === RSS_URL)!;
    expect(JSON.stringify(rssCall[1])).not.toContain(SECRET);
    expect(rssCall[1]!.headers).toEqual({ "User-Agent": "FoodRecalls/0.1 (personal household pilot)" });
  });

  test("fda.gov refuses the relay too: it reports the failure and health counts it", async () => {
    const t = setupConvex();
    await seedUnavailableHealth(t, NOW.getTime() - 18 * DAY);

    const summary = await runRelay({
      relayUrl: RELAY_URL,
      secret: SECRET,
      fetchImpl: relayFetch(t, "401"),
      log: () => {},
    });

    expect(summary).toEqual({ ok: false, error: `HTTP 401 for ${RSS_URL}`, state: "unavailable" });
    const health = await getHealth(t);
    expect(health!.consecutiveFailures).toBe(146);
    expect(health!.lastError).toBe(`relay: HTTP 401 for ${RSS_URL}`);
  });

  test("a wrong secret rejects instead of pretending to succeed", async () => {
    const t = setupConvex();
    await expect(
      runRelay({ relayUrl: RELAY_URL, secret: "nope", fetchImpl: relayFetch(t, "ok"), log: () => {} }),
    ).rejects.toThrow(/answered 401/);
    expect(await getHealth(t)).toBeNull();
  });
});
