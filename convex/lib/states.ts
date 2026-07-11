// State normalization (SPEC.md §4 enrichment step 5): "Nationwide", full names,
// and abbreviations all normalize to canonical two-letter codes; 'US' = nationwide.
// Distribution text is messy free text, so extraction is deliberately generous —
// an extra state means an extra alert, which is the safe failure direction.

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", "washington dc": "DC", "washington, d.c.": "DC",
  "puerto rico": "PR", guam: "GU", "virgin islands": "VI",
  "american samoa": "AS", "northern mariana islands": "MP",
};

export const VALID_STATE_CODES = new Set([
  ...Object.values(STATE_NAMES),
  "US",
]);

// Two-letter codes that are also common English words; in ALL-CAPS prose these
// match spuriously ("DISTRIBUTED IN GEORGIA" → IN), so they only count when they
// appear in list position (adjacent to a comma, slash, or ampersand).
const AMBIGUOUS_IN_CAPS = new Set(["IN", "OR", "OK", "HI", "ME", "DE", "LA", "OH", "ID", "AS"]);

const NATIONWIDE_RE =
  /\bnationwide\b|\bnational distribution\b|\ball (?:50 )?states\b|\bthroughout the (?:usa?|u\.s\.a?\.?|united states)\b|\bunited states\b|\bcontinental (?:us|u\.s\.)\b/i;

// Case-sensitive on purpose: lowercase "us" is the pronoun ("contact us").
const US_TOKEN_RE = /\bU\.?S\.?A?\.?(?=[^A-Za-z]|$)/;

/** Extract normalized state codes from free distribution text. */
export function parseStatesFromText(text: string): string[] {
  const found = new Set<string>();
  if (!text) return [];

  if (NATIONWIDE_RE.test(text) || US_TOKEN_RE.test(text)) found.add("US");

  const lower = text.toLowerCase();
  // Longest names first so "west virginia" doesn't also record "virginia".
  const names = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);
  let scrubbed = lower;
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/[.,]/g, "\\$&")}\\b`, "g");
    if (re.test(scrubbed)) {
      found.add(STATE_NAMES[name]!);
      scrubbed = scrubbed.replace(re, " ");
    }
  }

  const hasLowercase = /[a-z]/.test(text);
  const codeRe = /(^|[^A-Za-z])([A-Z]{2})(?=[^A-Za-z]|$)/g;
  for (const match of text.matchAll(codeRe)) {
    const code = match[2]!;
    if (!VALID_STATE_CODES.has(code) || code === "US") continue;
    if (!hasLowercase && AMBIGUOUS_IN_CAPS.has(code)) {
      // ALL-CAPS text: only trust ambiguous codes in list position.
      const idx = match.index! + match[1]!.length;
      const before = text.slice(Math.max(0, idx - 2), idx);
      const after = text.slice(idx + 2, idx + 4);
      if (!/[,&/]/.test(before) && !/[,&/]/.test(after)) continue;
    }
    found.add(code);
  }

  return [...found].sort();
}

/** Normalize an already-listed set of state values (e.g. FSIS comma list). */
export function normalizeStateList(values: string[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();
    if (upper === "US" || upper === "USA" || /^nationwide$/i.test(trimmed)) {
      found.add("US");
      continue;
    }
    if (upper.length === 2 && VALID_STATE_CODES.has(upper)) {
      found.add(upper);
      continue;
    }
    const byName = STATE_NAMES[trimmed.toLowerCase()];
    if (byName) found.add(byName);
  }
  return [...found].sort();
}
