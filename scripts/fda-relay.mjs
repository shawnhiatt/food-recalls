#!/usr/bin/env node
// FDA press relay client (health-audit ticket T5, 2026-11).
//
// www.fda.gov's Akamai bot manager answers Convex's shared egress with HTTP
// 401, while a plain fetch from elsewhere gets 200. This relay fetches the
// recalls RSS feed and any press pages Convex doesn't have yet, and POSTs the
// raw bodies to Convex's /relay/fda-rss HTTP action (convex/ingest/fdaRelay.ts),
// which parses them with the same adapter as Convex's own fetch. All parsing
// and matching stay in Convex; this file only moves bytes.
//
// Dependency-free so it runs under plain Node (the launchd job, see
// docs/fda-relay.md) and can be imported by a server route.
//
// CLI: FDA_RELAY_URL=https://<deployment>.convex.site/relay/fda-rss \
//      FDA_RELAY_SECRET=... node scripts/fda-relay.mjs
// Exit code 0 when the feed was relayed (even if a page failed and will be
// retried next run), 1 when the feed couldn't be read or Convex refused.

export const RSS_URL =
  "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml";
// The app's own User-Agent, as Convex's fetch sends. No header tricks.
const HEADERS = { "User-Agent": "FoodRecalls/0.1 (personal household pilot)" };
const PAGE_PAUSE_MS = 1000; // polite pacing between press-page fetches

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: HEADERS, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

const message = (error) => (error instanceof Error ? error.message : String(error));

/**
 * One relay run. Resolves to a summary; rejects only when Convex itself can't
 * be reached or refuses a request (bad secret, malformed body).
 *
 * @param {{ relayUrl: string, secret: string, fetchImpl?: typeof fetch,
 *           log?: (line: string) => void, pauseMs?: number }} options
 */
export async function runRelay({
  relayUrl,
  secret,
  fetchImpl = fetch,
  log = console.log,
  pauseMs = PAGE_PAUSE_MS,
}) {
  if (!relayUrl || !secret) throw new Error("FDA_RELAY_URL and FDA_RELAY_SECRET are required");

  const post = async (body) => {
    const response = await fetchImpl(relayUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Convex relay endpoint answered ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  };

  let rss;
  try {
    rss = await fetchText(fetchImpl, RSS_URL);
  } catch (error) {
    // Report it, so fda_rss health reflects the relay failing too (§10).
    const result = await post({ step: "failure", error: message(error) });
    log(`[fda-relay] feed fetch failed: ${message(error)} (fda_rss ${result.state})`);
    return { ok: false, error: message(error), state: result.state };
  }

  const plan = await post({ step: "feed", rss });
  log(
    `[fda-relay] feed relayed: ${plan.feedItems} item(s), ${plan.pages.length} new page(s), ` +
      `fda_rss ${plan.state}`,
  );

  let recorded = 0;
  let enriched = 0;
  const failedPages = [];
  for (const [index, item] of plan.pages.entries()) {
    if (index > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    let html;
    try {
      html = await fetchText(fetchImpl, item.url);
    } catch (error) {
      // One bad page never fails the run; Convex asks for it again next time.
      failedPages.push(item.url);
      log(`[fda-relay] page fetch failed, will retry next run: ${message(error)}`);
      continue;
    }
    const result = await post({ step: "page", item, html });
    recorded++;
    enriched += result.matched;
    log(`[fda-relay] page ${item.url}: ${result.matched} recall(s) enriched`);
  }

  return {
    ok: true,
    state: plan.state,
    feedItems: plan.feedItems,
    newPages: plan.pages.length,
    recorded,
    recallsEnriched: enriched,
    failedPages,
  };
}

// CLI entry (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  runRelay({
    relayUrl: process.env.FDA_RELAY_URL ?? "",
    secret: process.env.FDA_RELAY_SECRET ?? "",
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  })
    .then((summary) => {
      console.log(`${new Date().toISOString()} [fda-relay] ${JSON.stringify(summary)}`);
      process.exit(summary.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(`${new Date().toISOString()} [fda-relay] failed: ${message(error)}`);
      process.exit(1);
    });
}
