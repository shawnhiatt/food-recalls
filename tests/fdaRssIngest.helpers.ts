import { vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { setupConvex } from "./helpers";
import rssXml from "./fixtures/fda_rss/recalls-rss.xml?raw";
import pressHtml from "./fixtures/fda_rss/press-page.html?raw";

// Shared setup for the FDA press ingest action tests (convex/ingest/fdaRss.ts).
// The action is exercised end-to-end with a stubbed fetch, so no network is
// touched: fda.gov serves the recorded fixtures (or a 401, like Convex's
// egress has seen since 2026-10-24), and Open Food Facts returns one image.

type T = ReturnType<typeof setupConvex>;

export const NOW = new Date("2026-07-11T12:00:00Z");
export const RSS_URL =
  "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml";
/** The one feed item whose press page the stub serves (the fixture page). */
export const BLUEBERRY_PAGE =
  "http://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/frutas-y-hortalizas-del-sur-sa-initiates-recall-frozen-greenwise-organic-iqf-blueberries-due";
export const OFF_IMAGE = "https://images.openfoodfacts.org/front.jpg";

export function stubFetch(opts: { fdaGov: "ok" | "401" }) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const respond = (status: number, body: string) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => JSON.parse(body),
    });
    if (url.startsWith("https://world.openfoodfacts.org/")) {
      return respond(200, JSON.stringify({ product: { image_front_url: OFF_IMAGE } }));
    }
    if (url.includes("fda.gov")) {
      if (opts.fdaGov === "401") return respond(401, "Sorry! This resembles an automated request.");
      if (url === RSS_URL) return respond(200, rssXml);
      if (url === BLUEBERRY_PAGE) return respond(200, pressHtml);
      return respond(404, "not found");
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export async function insertRecall(
  t: T,
  over: { firm: string; recallDate: string; productCodes?: string[] },
): Promise<Id<"recalls">> {
  return await t.run((ctx) =>
    ctx.db.insert("recalls", {
      source: "fda",
      sourceId: `R-${Math.random()}`,
      title: "Recall",
      firm: over.firm,
      classification: "Class I",
      rawStatus: "Ongoing",
      lifecycle: "active",
      recallDate: over.recallDate,
      productDesc: "product",
      states: ["NC"],
      distribution: "NC",
      productCodes: over.productCodes ?? [],
      allergens: [],
      audience: "human",
      hazardType: "allergen",
      riskGroups: [],
      sourceUrl: "https://api.fda.gov/food/enforcement.json?search=recall_number:%22X%22",
      raw: {},
      contentHash: "hash-1",
      updateHistory: [],
      firstSeenAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

/**
 * A press item fetched before the outage whose openFDA record hadn't landed
 * yet, like the 2026-10-09 Oliva to Go baba ghanouj release.
 */
export const PENDING_PRESS = {
  guid: "https://www.fda.gov/press/oliva-baba-ghanouj",
  url: "https://www.fda.gov/press/oliva-baba-ghanouj",
  title: "Riad's Oliva to Go Recalls Spicy Baba Ghanouj Due to Undeclared Sesame",
  publishedAt: "2026-07-05",
  companyName: "Riad's Oliva to Go",
  productType: "Food & Beverages",
  relevant: true,
  imageUrl: "https://www.fda.gov/files/baba-ghanouj.png",
  riskGroups: ["allergy"],
};

export async function insertPendingPress(t: T): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("pressItems", {
      ...PENDING_PRESS,
      matchedRecallIds: [],
      fetchedAt: Date.now(),
      lastMatchAttemptAt: Date.now(),
    }),
  );
}

/** Seed `fda_rss` as prod looked on 2026-11-11: unavailable, long failure streak. */
export async function seedUnavailableHealth(t: T, lastSuccessAt: number): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("sourceHealth", {
      source: "fda_rss",
      state: "unavailable",
      lastAttemptAt: Date.now() - 3 * 60 * 60 * 1000,
      lastSuccessAt,
      consecutiveFailures: 145,
      lastError: `HTTP 401 for ${RSS_URL}`,
    }),
  );
}

export const getHealth = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query("sourceHealth")
      .withIndex("by_source", (q) => q.eq("source", "fda_rss"))
      .unique(),
  );
