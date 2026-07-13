// CDC outbreak investigations adapter (SPEC.md §3, §4 — Phase 4). No clean
// structured API (§3): this scrapes CDC's "Current Outbreak List" landing
// page for foodborne-pathogen entries, then each entry's own investigation
// page for the fields the list doesn't carry (status, case counts, risk-group
// prose). Convex actions have no DOMParser, so both parsers are regex-based
// and deliberately tolerant, like the FDA RSS/press adapter — a page that
// fails to parse yields empty/undefined fields, never a throw.
//
// Outbreak records are thin by nature (§3 "honest limitations"): CDC's own
// per-state case breakdown is rendered by a client-side JS chart widget
// (COVE) fed from a per-outbreak JSON file whose path isn't derivable from
// the outbreak's slug, so `states` here is a best-effort extraction from
// prose mentioned on the investigation page itself (recalled-product
// distribution text, "X states" summaries) via the same parseStatesFromText
// used as FSIS's fallback — not the authoritative case-location list. This
// is consistent with §7's acknowledged degradation: "matching degrades to
// state + keyword" for outbreaks.

import { extractRiskGroups } from "../lib/enrichment";
import { parseStatesFromText } from "../lib/states";
import { mapCdcOutbreakStatus } from "../lib/lifecycle";
import { computeOutbreakContentHash } from "../lib/contentHash";

const CDC_ORIGIN = "https://www.cdc.gov";

const decodeEntities = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0?39);/g, "'")
    .replace(/&nbsp;/g, " ");

const stripTags = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${CDC_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** "https://www.cdc.gov/ecoli/outbreaks/blueberries-07-26/index.html" -> "ecoli/outbreaks/blueberries-07-26" */
export function sourceIdFromUrl(url: string): string {
  return absoluteUrl(url)
    .replace(/^https?:\/\/(www\.)?cdc\.gov\//i, "")
    .replace(/\/index\.html$/i, "")
    .replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// List page ("Current Outbreak List") — the "U.S. Outbreaks" feed section
// mixes foodborne investigations with unrelated ones (Measles, COVID-19,
// Mpox); only pathogen-keyword matches belong in this app (§16 scope: US
// food + outbreaks, not general disease surveillance).
// ---------------------------------------------------------------------------

export type CdcListItem = {
  url: string;
  title: string;
  /** ISO date (YYYY-MM-DD) from the list card, used as a fallback only. */
  publishedAt: string;
};

const LIST_ITEM_RE =
  /<a href="([^"]+)"\s+aria-label="[^"]*">([\s\S]*?)<\/a>[\s\S]*?<time class="dfe-block-feed-item__date" datetime="([^"]+)"/g;

/** Parse the "U.S. Outbreaks" section of https://www.cdc.gov/outbreaks/index.html. */
export function parseOutbreakListItems(html: string): CdcListItem[] {
  const sectionStart = html.indexOf('data-section="cdc_homepage_feed1"');
  if (sectionStart === -1) return [];
  const nextSection = html.indexOf(
    '<div class="dfe-section dfe-section--feed"',
    sectionStart + 1,
  );
  const section = nextSection === -1 ? html.slice(sectionStart) : html.slice(sectionStart, nextSection);

  const items: CdcListItem[] = [];
  for (const match of section.matchAll(LIST_ITEM_RE)) {
    const url = match[1]!;
    const title = stripTags(match[2]!);
    const datetime = match[3]!;
    if (!url || !title) continue;
    items.push({
      url: absoluteUrl(url),
      title,
      publishedAt: datetime.slice(0, 10),
    });
  }
  return items;
}

const FOODBORNE_PATHOGEN_RE =
  /\b(e\.?\s?coli|escherichia|salmonella|listeria|botulism|clostridium|campylobacter|norovirus|cyclospora(?:sis)?|shigella(?:osis)?|vibrio(?:sis)?|hepatitis a|cronobacter|staphylococc\w*|yersinia)\b/i;

/** Keyword gate over the list-card title — cheap, avoids fetching every non-food investigation's detail page. */
export function isFoodbornePathogenTitle(title: string): boolean {
  return FOODBORNE_PATHOGEN_RE.test(title);
}

const TITLE_RE = /^(.+?)\s+Outbreaks?\s+[Ll]inked\s+to\s+(.+)$/;

/** "E. coli Outbreak Linked to Frozen Blueberries" -> { pathogen: "E. coli", suspectedFood: "Frozen Blueberries" } */
export function parseOutbreakTitle(title: string): { pathogen: string; suspectedFood?: string } {
  const match = TITLE_RE.exec(title.trim());
  if (!match) return { pathogen: title.trim() };
  return { pathogen: match[1]!.trim(), suspectedFood: match[2]!.trim() || undefined };
}

// ---------------------------------------------------------------------------
// Detail page (one per investigation) — status, fast-facts counts, and body
// text for risk-group/state extraction.
// ---------------------------------------------------------------------------

export type CdcOutbreakDetail = {
  /** ISO date (YYYY-MM-DD); "" if unparseable. */
  publishedAt: string;
  investigationStatus: "active" | "resolved";
  cases?: number;
  hospitalizations?: number;
  /** Stripped page text, for risk-group + best-effort state extraction. */
  bodyText: string;
};

const DATE_RE =
  /<time class="cdc-page-title-bar__item cdc-page-title-bar__item--date" datetime="([^"]+)"/;
const STATUS_RE = /<span class="label">\s*Investigation status:\s*<\/span>\s*([A-Za-z]+)/;
const FACT_RE = /<li><span class="fact-top label">([^<]+)<\/span>:\s*([^<]*)<\/li>/g;

function parseLeadingInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /(\d[\d,]*)/.exec(value);
  if (!match) return undefined;
  return parseInt(match[1]!.replace(/,/g, ""), 10);
}

export function parseOutbreakDetailPage(html: string): CdcOutbreakDetail {
  const dateMatch = DATE_RE.exec(html);
  const publishedAt = dateMatch ? dateMatch[1]!.slice(0, 10) : "";

  const statusMatch = STATUS_RE.exec(html);
  const investigationStatus = mapCdcOutbreakStatus(statusMatch ? statusMatch[1]! : "");

  const facts = new Map<string, string>();
  for (const match of html.matchAll(FACT_RE)) {
    facts.set(match[1]!.trim(), match[2]!.trim());
  }

  const bodyText = stripTags(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "),
  ).slice(0, 20000);

  return {
    publishedAt,
    investigationStatus,
    cases: parseLeadingInt(facts.get("Cases")),
    hospitalizations: parseLeadingInt(facts.get("Hospitalizations")),
    bodyText,
  };
}

// ---------------------------------------------------------------------------
// Combiner — pure, so ingest can stay a thin fetch-then-normalize action.
// ---------------------------------------------------------------------------

export type NormalizedOutbreak = {
  source: "cdc";
  sourceId: string;
  title: string;
  pathogen: string;
  suspectedFood?: string;
  states: string[];
  status: "active" | "resolved";
  caseCount?: number;
  hospitalizations?: number;
  riskGroups: string[];
  sourceUrl: string;
  publishedAt: string;
  raw: unknown;
  contentHash: string;
};

export function normalizeOutbreak(item: CdcListItem, detail: CdcOutbreakDetail): NormalizedOutbreak {
  const { pathogen, suspectedFood } = parseOutbreakTitle(item.title);
  const states = parseStatesFromText(detail.bodyText);
  const riskGroups = extractRiskGroups(detail.bodyText);
  const publishedAt = detail.publishedAt || item.publishedAt;

  return {
    source: "cdc",
    sourceId: sourceIdFromUrl(item.url),
    title: item.title,
    pathogen,
    suspectedFood,
    states,
    status: detail.investigationStatus,
    caseCount: detail.cases,
    hospitalizations: detail.hospitalizations,
    riskGroups,
    sourceUrl: item.url,
    publishedAt,
    raw: {
      url: item.url,
      title: item.title,
      investigationStatus: detail.investigationStatus,
      cases: detail.cases ?? null,
      hospitalizations: detail.hospitalizations ?? null,
      publishedAt,
    },
    contentHash: computeOutbreakContentHash({
      pathogen,
      suspectedFood,
      states,
      status: detail.investigationStatus,
      caseCount: detail.cases,
      hospitalizations: detail.hospitalizations,
    }),
  };
}
