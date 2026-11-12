import { httpAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { planFeed, recordPressPage } from "./fdaRss";

// FDA press relay endpoint (health-audit ticket T5, 2026-11). www.fda.gov's
// Akamai bot manager answers Convex's shared egress with HTTP 401, so an
// off-Convex relay fetches the RSS feed and press pages with a plain fetch and
// POSTs the raw bodies here. Parsing stays in convex/adapters/fdaRss.ts, and
// recording goes through the same planFeed / recordPressPage path as Convex's
// own fetch (convex/ingest/fdaRss.ts), which keeps running every 3h so the
// source recovers on its own if fda.gov unblocks.
//
// Protocol, one JSON body per POST, `Authorization: Bearer <FDA_RELAY_SECRET>`:
//   { step: "feed", rss }            → reports fda_rss health (relay transport)
//                                      and returns the new press items to fetch
//   { step: "page", item, html }     → records one press page
//   { step: "failure", error }       → the relay couldn't read the feed; counts
//                                      as a failed fda_rss run (§10)
// A bad or missing secret is 401, an unset secret 503, a malformed body 400.
// None of those touch sourceHealth: an unauthenticated or garbled request says
// nothing about whether FDA's feed is reachable.

/** Max new press items returned per feed POST. The feed holds ~20 items. */
export const MAX_RELAY_PAGES = 25;
/** Feed ~20 KB, press pages ~45 KB; anything near this is not FDA's content. */
const MAX_BODY_BYTES = 2_000_000;
const MAX_FIELD = 1_000_000;

type RelayItem = { guid: string; url: string; title: string; publishedAt: string };
type RelayBody =
  | { step: "feed"; rss: string }
  | { step: "page"; item: RelayItem; html: string }
  | { step: "failure"; error: string };

const isString = (value: unknown, max = MAX_FIELD): value is string =>
  typeof value === "string" && value.length <= max;

/** Validate a decoded relay body; null when it doesn't match the protocol. */
export function parseRelayBody(value: unknown): RelayBody | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  switch (body.step) {
    case "feed":
      return isString(body.rss) ? { step: "feed", rss: body.rss } : null;
    case "failure":
      return isString(body.error, 2000) && body.error.length > 0
        ? { step: "failure", error: body.error }
        : null;
    case "page": {
      const item = body.item as Record<string, unknown> | null | undefined;
      if (typeof item !== "object" || item === null || !isString(body.html)) return null;
      const { guid, url, title, publishedAt } = item;
      if (![guid, url, title, publishedAt].every((f) => isString(f, 4000))) return null;
      if (!isFdaUrl(url as string) || !guid || !title) return null;
      return {
        step: "page",
        item: {
          guid: guid as string,
          url: url as string,
          title: title as string,
          publishedAt: publishedAt as string,
        },
        html: body.html,
      };
    }
    default:
      return null;
  }
}

/** Press pages live on www.fda.gov; the feed links them over http://. */
function isFdaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname === "www.fda.gov"
    );
  } catch {
    return false;
  }
}

/** Constant-time comparison of the presented secret with the configured one. */
async function secretMatches(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [presented, expected].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))),
  );
  const x = new Uint8Array(a!);
  const y = new Uint8Array(b!);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const fdaRssRelay = httpAction(async (ctx, request) => {
  const expected = process.env.FDA_RELAY_SECRET;
  if (!expected) return json(503, { error: "relay not configured" });

  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!presented || !(await secretMatches(presented, expected))) {
    return json(401, { error: "unauthorized" });
  }

  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { error: "body too large" });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { error: "body too large" });

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return json(400, { error: "body is not JSON" });
  }
  const body = parseRelayBody(decoded);
  if (body === null) return json(400, { error: "body does not match the relay protocol" });

  return json(200, await handle(ctx, body));
});

async function handle(ctx: ActionCtx, body: RelayBody) {
  switch (body.step) {
    case "feed": {
      const { items, toFetch, anomaly } = await planFeed(ctx, body.rss, MAX_RELAY_PAGES);
      const health = await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda_rss",
        outcome: "success",
        newRecords: toFetch.length,
        anomaly,
        transport: "relay",
      });
      console.log(
        `[fda_rss:relay] feed ${items.length} item(s), ${toFetch.length} new` +
          (anomaly ? " (anomaly: zero items)" : "") +
          `, fda_rss ${health.state}`,
      );
      return {
        feedItems: items.length,
        anomaly,
        state: health.state,
        pages: toFetch.map(({ guid, url, title, publishedAt }) => ({
          guid,
          url,
          title,
          publishedAt,
        })),
      };
    }
    case "page": {
      const result = await recordPressPage(ctx, body.item, body.html);
      console.log(`[fda_rss:relay] page ${body.item.url}: ${result.matched} recall(s) enriched`);
      return result;
    }
    case "failure": {
      const health = await ctx.runMutation(internal.sourceHealth.reportRun, {
        source: "fda_rss",
        outcome: "failure",
        error: `relay: ${body.error}`,
        transport: "relay",
      });
      console.warn(`[fda_rss:relay] relay reported failure: ${body.error}`);
      return { state: health.state, counted: health.counted };
    }
  }
}
