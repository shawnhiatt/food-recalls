import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  isFoodRelated,
  parsePressPage,
  parseRssItems,
  type PressRssItem,
} from "../adapters/fdaRss";
import { extractRiskGroups } from "../lib/enrichment";

// FDA Recalls RSS / press-release ingest (SPEC.md §3/§4 — Phase 1 item).
// Every 3h: fetch the feed, fetch the (few) new press pages, extract photo +
// risk-group text, and enrich matching enforcement records via convex/press.ts.
// Then retry unmatched items (enforcement records lag press releases), and
// finish with the Open Food Facts image fallback for recent recalls that
// still have no photo (§3 fallback chain, rung 2). The three steps are
// isolated: see the note above `ingest`.

const RSS_URL =
  "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml";
const OFF_URL = "https://world.openfoodfacts.org/api/v2/product";

// Polite pacing: the feed adds a handful of items per week, so small per-run
// caps clear any backlog within a day of cron runs without hammering anyone.
const MAX_PRESS_FETCHES_PER_RUN = 8;
const MAX_OFF_LOOKUPS_PER_RUN = 5;

// fda.gov serves plain fetches fine (unlike FSIS) but a UA is good manners;
// Open Food Facts' API guidelines ask callers to identify their app.
const HEADERS = { "User-Agent": "FoodRecalls/0.1 (personal household pilot)" };

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

/** Open Food Facts image by UPC; null when unknown or imageless. */
async function fetchOffImage(upc: string): Promise<string | null> {
  const response = await fetch(
    `${OFF_URL}/${encodeURIComponent(upc)}.json?fields=image_front_url,image_url`,
    { headers: HEADERS },
  );
  if (!response.ok) return null; // 404 = unknown product, not an error
  const body = (await response.json()) as {
    product?: { image_front_url?: string; image_url?: string };
  };
  return body.product?.image_front_url ?? body.product?.image_url ?? null;
}

export type PressIngestSummary = {
  feedItems: number;
  pagesFetched: number;
  recallsEnriched: number;
  relinked: number;
  offImages: number;
  /** Steps that threw this run (feed, relink, off); empty on a clean run. */
  failedSteps: PressIngestStep[];
};

export type PressIngestStep = "feed" | "relink" | "off";

// The run is three independent steps (T1, 2026-11 health audit). Only the
// feed step touches fda.gov; relink is pure DB work and the OFF fallback calls
// Open Food Facts. They used to share one try block, so when fda.gov started
// answering Convex's egress with HTTP 401 (2026-10-24) relink and OFF stopped
// too, and press items already in the DB never joined later openFDA records.
// Now each step catches its own failure and logs with its own tag, and the
// others still run.
//
// sourceHealth (§10): `fda_rss` reports the FEED step only. That state means
// "are we seeing FDA's press feed," which is what the reassurance gate needs
// to know. Relink and OFF don't observe the feed, so their success must never
// mark the source current while fda.gov is unreachable. Their failures are
// internal bugs or an optional enrichment API (OFF isn't a §10 source), not a
// coverage gap, so they log and fail the run without flipping `fda_rss`.
export const ingest = internalAction({
  args: {},
  handler: async (ctx): Promise<PressIngestSummary> => {
    const failures: { step: PressIngestStep; message: string }[] = [];
    const fail = (step: PressIngestStep, error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fda_rss:${step}] failed: ${message}`);
      failures.push({ step, message });
    };

    // Step 1: feed + new press pages, the only step that reports health.
    let feed: FeedResult = { feedItems: 0, pagesFetched: 0, recallsEnriched: 0 };
    try {
      feed = await ingestFeed(ctx);
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda_rss",
        outcome: "success",
        newRecords: feed.pagesFetched,
        anomaly: feed.anomaly,
      });
      console.log(`[fda_rss:feed] ${JSON.stringify(feed)}`);
    } catch (error) {
      fail("feed", error);
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda_rss",
        outcome: "failure",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Step 2: retry unmatched press items already in the DB (enforcement
    // records lag press releases). Needs no network.
    let relinked = 0;
    try {
      const relink = await ctx.runMutation(internal.press.relinkUnmatched, {});
      relinked = relink.relinked;
      console.log(`[fda_rss:relink] relinked ${relinked} of ${relink.attempted} tried`);
    } catch (error) {
      fail("relink", error);
    }

    // Step 3: §3 fallback chain rung 2, Open Food Facts by UPC for recent
    // recalls still without a press image.
    let offImages = 0;
    try {
      offImages = await applyOffFallback(ctx);
      console.log(`[fda_rss:off] applied ${offImages} image(s)`);
    } catch (error) {
      fail("off", error);
    }

    const summary: PressIngestSummary = {
      feedItems: feed.feedItems,
      pagesFetched: feed.pagesFetched,
      recallsEnriched: feed.recallsEnriched,
      relinked,
      offImages,
      failedSteps: failures.map((f) => f.step),
    };
    console.log(`[fda_rss] ingest: ${JSON.stringify(summary)}`);

    // Still fail the run (dashboard + cron log) when any step failed, but only
    // after every step has had its turn.
    if (failures.length > 0) {
      throw new Error(failures.map((f) => `${f.step}: ${f.message}`).join("; "));
    }
    return summary;
  },
});

type FeedResult = {
  feedItems: number;
  pagesFetched: number;
  recallsEnriched: number;
  anomaly?: boolean;
};

/** Fetch the RSS feed and the (few) new press pages it lists. Throws if the feed can't be read. */
async function ingestFeed(ctx: ActionCtx): Promise<FeedResult> {
  const xml = await fetchText(RSS_URL);
  const items = parseRssItems(xml);

  // Zero items from a feed that has produced items before is a parse/feed
  // anomaly, not a quiet news week (§10, §15 scraper fragility).
  const hadItems: boolean = await ctx.runQuery(internal.press.hasAny, {});
  const anomaly = items.length === 0 && hadItems;

  const newGuids: string[] = await ctx.runQuery(internal.press.filterNewGuids, {
    guids: items.map((i) => i.guid),
  });
  const newGuidSet = new Set(newGuids);
  const toFetch = items
    .filter((i) => newGuidSet.has(i.guid))
    .slice(0, MAX_PRESS_FETCHES_PER_RUN);

  let pagesFetched = 0;
  let recallsEnriched = 0;
  for (const item of toFetch) {
    const result = await ingestPressItem(ctx, item);
    if (result === null) continue; // one bad page never fails the run
    pagesFetched++;
    recallsEnriched += result.matched;
  }
  return { feedItems: items.length, pagesFetched, recallsEnriched, anomaly };
}

/** Open Food Facts image fallback; returns how many recalls got an image. */
async function applyOffFallback(ctx: ActionCtx): Promise<number> {
  let offImages = 0;
  const candidates = await ctx.runQuery(internal.recalls.recentWithoutImage, {
    limit: MAX_OFF_LOOKUPS_PER_RUN,
  });
  for (const candidate of candidates) {
    for (const upc of candidate.productCodes.slice(0, 2)) {
      const imageUrl = await fetchOffImage(upc).catch(() => null);
      if (imageUrl) {
        await ctx.runMutation(internal.recalls.applyImageFallback, {
          recallId: candidate._id,
          imageUrl,
        });
        offImages++;
        break;
      }
    }
  }
  return offImages;
}

/** Fetch + parse + record one press page; null (with a log) on failure. */
async function ingestPressItem(
  ctx: ActionCtx,
  item: PressRssItem,
): Promise<{ matched: number } | null> {
  try {
    const html = await fetchText(item.url);
    const press = parsePressPage(html);
    const relevant = isFoodRelated(press.productType);
    return await ctx.runMutation(internal.press.recordPressItem, {
      guid: item.guid,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      companyName: press.companyName,
      productType: press.productType,
      relevant,
      imageUrl: press.imageUrl,
      riskGroups: relevant ? extractRiskGroups(press.bodyText) : [],
    });
  } catch (error) {
    console.warn(
      `[fda_rss] press page failed, will retry next run: ${item.url} — ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}
