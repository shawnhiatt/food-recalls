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
// still have no photo (§3 fallback chain, rung 2).

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
};

export const ingest = internalAction({
  args: {},
  handler: async (ctx): Promise<PressIngestSummary> => {
    try {
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

      const { relinked } = await ctx.runMutation(internal.press.relinkUnmatched, {});

      // §3 fallback chain rung 2: Open Food Facts by UPC for recent recalls
      // still without a press image.
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

      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda_rss",
        outcome: "success",
        newRecords: pagesFetched,
        anomaly,
      });
      const summary: PressIngestSummary = {
        feedItems: items.length,
        pagesFetched,
        recallsEnriched,
        relinked,
        offImages,
      };
      console.log(`[fda_rss] ingest: ${JSON.stringify(summary)}`);
      return summary;
    } catch (error) {
      await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda_rss",
        outcome: "failure",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

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
