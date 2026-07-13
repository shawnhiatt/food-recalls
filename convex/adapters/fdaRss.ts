// FDA Recalls RSS / press-release adapter (SPEC.md §3, §4 — Phase 1 item).
// Two inputs, both parsed with fixtures like the other adapters:
//  - the recalls RSS feed (title/link/description/pubDate per item);
//  - individual press-release pages, which carry what the enforcement API
//    lacks: real product photos, a structured summary panel (Company Name,
//    Product Type, Brand, Product Description), and "who's at risk" prose.
//
// Unlike openFDA/FSIS this adapter does NOT emit recall records: press items
// ENRICH existing API records (image, risk groups, official notice URL),
// matched by company name + date proximity in convex/press.ts. Convex actions
// have no DOMParser, so both parsers are regex-based and deliberately
// tolerant — a page that fails to parse yields empty fields, never a throw.

const FDA_ORIGIN = "https://www.fda.gov";

export type PressRssItem = {
  guid: string;
  url: string;
  title: string;
  description: string;
  publishedAt: string; // ISO date (YYYY-MM-DD)
};

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

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeEntities(match[1]!).trim() : "";
}

/** RFC-822 pubDate ("Mon, 06 Jul 2026 13:49:00 EDT") → ISO date; "" if unparseable. */
export function parseRssDate(value: string): string {
  const text = value.trim();
  if (!text) return "";
  let ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    // Some runtimes don't know US timezone abbreviations; retry as GMT — a
    // few hours of skew is irrelevant for a date-only field.
    ms = Date.parse(text.replace(/\s+[A-Z]{2,4}$/, " GMT"));
  }
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse the recalls RSS feed. Items without a usable link are skipped. */
export function parseRssItems(xml: string): PressRssItem[] {
  const items: PressRssItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1]!;
    const url = tagText(block, "link");
    const title = tagText(block, "title");
    if (!url || !title) continue;
    items.push({
      guid: tagText(block, "guid") || url,
      url,
      title,
      description: tagText(block, "description"),
      publishedAt: parseRssDate(tagText(block, "pubDate")),
    });
  }
  return items;
}

export type PressPageData = {
  companyName: string;
  brandNames: string[];
  productType: string;
  productDescription: string;
  /** First recall photo under /files/ — press pages' og:image is a generic FDA card. */
  imageUrl?: string;
  /** Stripped announcement text, for risk-group extraction. */
  bodyText: string;
};

/** The value of one `<dt>Label:</dt><dd>…</dd>` pair from the summary panel. */
function summaryField(html: string, label: string): string {
  const match = html.match(
    new RegExp(`<dt[^>]*>\\s*${label}:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, "i"),
  );
  if (!match) return "";
  const dd = match[1]!;
  // Values are either plain text or nested Drupal `field--item` divs.
  const fieldItems = [...dd.matchAll(/field--item">([\s\S]*?)<\/div>/g)].map((m) =>
    stripTags(m[1]!),
  );
  if (fieldItems.length > 0) return fieldItems.join("; ");
  // Drop the redundant `field--label` heading if present, then strip.
  return stripTags(dd.replace(/<div class="field--label">[\s\S]*?<\/div>/g, " "));
}

export function parsePressPage(html: string): PressPageData {
  // First image under /files/ is the product photo; site chrome (flags,
  // logos) lives under /themes/ and the og:image is FDA's generic social card.
  const imgMatch = html.match(/<img[^>]*src="(\/files\/[^"]+)"/i);
  const imageUrl = imgMatch ? `${FDA_ORIGIN}${decodeEntities(imgMatch[1]!)}` : undefined;

  // Risk prose lives in the announcement body; fall back to the whole page
  // when the anchor is missing (older page templates).
  const announcementStart = html.indexOf('id="recall-announcement"');
  const body = announcementStart >= 0 ? html.slice(announcementStart) : html;
  const bodyText = stripTags(
    body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "),
  ).slice(0, 20000);

  return {
    companyName: summaryField(html, "Company Name"),
    brandNames: summaryField(html, "Brand Name")
      .split(";")
      .map((b) => b.trim())
      .filter(Boolean),
    productType: summaryField(html, "Product Type"),
    productDescription: summaryField(html, "Product Description"),
    imageUrl,
    bodyText,
  };
}

/**
 * The RSS feed covers ALL FDA-regulated products (drugs, devices, cosmetics).
 * Only food and animal/pet items belong here; an empty product type is
 * treated as relevant (inclusive bias — a wrongly-included item just fails
 * to match any recall).
 */
export function isFoodRelated(productType: string): boolean {
  if (!productType.trim()) return true;
  return /food|beverage|animal|veterinary|dietary|supplement/i.test(productType);
}

// ---------------------------------------------------------------------------
// Firm-name matching (press "Company Name" ↔ enforcement `recalling_firm`).
// ---------------------------------------------------------------------------

const FIRM_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "lp",
  "co",
  "corp",
  "corporation",
  "company",
  "ltd",
  "limited",
  "dba",
  "us",
  "usa",
  "the",
]);

/** Lowercase, strip punctuation, drop corporate suffixes and stray initials. */
export function normalizeFirmName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !FIRM_SUFFIXES.has(token))
    .join(" ");
}

/**
 * Do a press company name and an API firm name plausibly refer to the same
 * company? Containment either way after normalization — press pages write
 * "Mars Petcare US, Inc.", enforcement records "Mars Petcare".
 */
export function firmsLikelySame(a: string, b: string): boolean {
  const na = normalizeFirmName(a);
  const nb = normalizeFirmName(b);
  if (na.length < 4 || nb.length < 4) return false;
  return na.includes(nb) || nb.includes(na);
}
