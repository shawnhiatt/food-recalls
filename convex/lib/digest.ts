// Daily digest composition (SPEC.md §9) — pure text builders so the reassurance
// gate (§10) and the empty-digest variants are unit-testable without Convex or
// Resend. The digest sends EVEN WHEN EMPTY: the empty digest is the trust
// mechanism (§9), but its reassurance copy is only permitted when every enabled
// source is Current (§10, §17.13). Any degraded source switches the copy to
// explicit incompleteness.

import type { HealthState, Source } from "../sourceHealth";
import type { MatchDimension } from "./matching";

export type DigestSeverity = "class1" | "class2" | "class3" | "unknown";

/** One matched-alert line in the digest. */
export type DigestMatchItem = {
  kind: "match";
  title: string;
  firm: string;
  severity: DigestSeverity;
  matchedOn: MatchDimension[];
  confidence: "high" | "possible";
  url: string;
};

/** One closure/correction line (§9 matrix: only for previously-notified members). */
export type DigestClosureItem = {
  kind: "closure";
  title: string;
  lifecycle: "completed" | "terminated" | "withdrawn" | "corrected";
  url: string;
};

/**
 * One matched OUTBREAK line (§4 Phase 4/§11). Outbreaks get a distinct "be
 * aware" voice — no recall-style severity label — so they render in their own
 * section rather than mixed into "recalls affect your household." Carries
 * `pathogen` where a recall carries `firm`.
 */
export type DigestOutbreakItem = {
  kind: "outbreak";
  title: string;
  pathogen: string;
  matchedOn: MatchDimension[];
  url: string;
};

/** One outbreak resolution line — the outbreak analog of DigestClosureItem. */
export type DigestOutbreakClosureItem = {
  kind: "outbreak_closure";
  title: string;
  url: string;
};

export type DigestItem =
  | DigestMatchItem
  | DigestClosureItem
  | DigestOutbreakItem
  | DigestOutbreakClosureItem;

export type SourceStatusLine = {
  source: Source;
  state: HealthState;
  lastSuccessAt: number;
};

export type DigestInput = {
  householdName: string;
  items: DigestItem[];
  /** From sourceHealth.getPublicStatus — gates reassurance copy (§10). */
  allSourcesCurrent: boolean;
  sources: SourceStatusLine[];
  /** For "Data current as of …" in the footer. */
  now: number;
  /** One-click email unsubscribe link for this member (§2). */
  unsubscribeUrl?: string;
};

const SEVERITY_LABEL: Record<DigestSeverity, string> = {
  class1: "High risk",
  class2: "Moderate risk",
  class3: "Low risk",
  unknown: "Risk level unknown",
};

const SEVERITY_RANK: Record<DigestSeverity, number> = {
  class1: 0,
  class2: 1,
  class3: 2,
  unknown: 3,
};

const DIMENSION_LABEL: Record<MatchDimension, string> = {
  state: "Your state",
  brand: "Your brand",
  keyword: "Your keyword",
  allergen: "Allergen match",
  risk_group: "At-risk member",
  pet: "Pet food",
  chain: "Possible store match",
};

const SOURCE_LABEL: Record<Source, string> = {
  fda: "FDA recall data",
  fsis: "USDA meat & poultry data",
  fda_rss: "FDA press release data",
  cdc: "CDC outbreak data",
};

const LIFECYCLE_LABEL: Record<DigestClosureItem["lifecycle"], string> = {
  completed: "resolved",
  terminated: "resolved",
  withdrawn: "withdrawn",
  corrected: "corrected",
};

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Digest scheduling (§9: "sends at each member's digestHour" in their tz).
// Pure so the hourly-cron eligibility check is unit-testable.
// ---------------------------------------------------------------------------

/** The member's current local hour (0–23) in their IANA timezone. */
export function getLocalHour(now: number, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(now));
    const hour = parts.find((p) => p.type === "hour")?.value;
    if (hour !== undefined) return parseInt(hour, 10) % 24;
  } catch {
    // Unknown/invalid timezone — fall back to UTC rather than throw.
  }
  return new Date(now).getUTCHours();
}

const DIGEST_MIN_GAP_MS = 23 * 60 * 60 * 1000;

/**
 * Is this member due for a digest right now? True only in the local hour that
 * matches `digestHour`, and not if one already went out in the last ~day — so
 * the hourly cron fires each member exactly once per day even across DST shifts
 * or scheduler reruns.
 */
export function isDigestDue(params: {
  now: number;
  timezone: string;
  digestHour: number;
  lastDigestAt?: number;
}): boolean {
  const { now, timezone, digestHour, lastDigestAt } = params;
  if (getLocalHour(now, timezone) !== digestHour) return false;
  if (lastDigestAt !== undefined && now - lastDigestAt < DIGEST_MIN_GAP_MS) {
    return false;
  }
  return true;
}

/**
 * Order items for display: recall matches (by severity), then outbreak matches,
 * then all closures (recall + outbreak). Keeps recall-only inputs identical to
 * the pre-outbreak behavior.
 */
export function sortDigestItems(items: DigestItem[]): DigestItem[] {
  const matches = items.filter((i): i is DigestMatchItem => i.kind === "match");
  const outbreaks = items.filter(
    (i): i is DigestOutbreakItem => i.kind === "outbreak",
  );
  const closures = items.filter(
    (i): i is DigestClosureItem => i.kind === "closure",
  );
  const outbreakClosures = items.filter(
    (i): i is DigestOutbreakClosureItem => i.kind === "outbreak_closure",
  );
  matches.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return [...matches, ...outbreaks, ...closures, ...outbreakClosures];
}

/**
 * The digest subject line. Non-empty digests name the count; empty digests
 * carry the reassurance/incompleteness distinction (§10) into the subject so
 * the gate is visible before the email is even opened.
 */
export function digestSubject(input: DigestInput): string {
  const matchCount = input.items.filter((i) => i.kind === "match").length;
  const outbreakCount = input.items.filter((i) => i.kind === "outbreak").length;

  if (matchCount > 0 && outbreakCount > 0) {
    const r = matchCount === 1 ? "1 recall" : `${matchCount} recalls`;
    const o = outbreakCount === 1 ? "1 outbreak" : `${outbreakCount} outbreaks`;
    return `${r} and ${o} affect your household`;
  }
  if (matchCount > 0) {
    return matchCount === 1
      ? "1 new recall affects your household"
      : `${matchCount} new recalls affect your household`;
  }
  if (outbreakCount > 0) {
    return outbreakCount === 1
      ? "1 active outbreak may affect your household"
      : `${outbreakCount} active outbreaks may affect your household`;
  }
  return input.allSourcesCurrent
    ? "You're all clear — no new recalls affect your household"
    : "Daily recall check — coverage is currently incomplete";
}

/**
 * The reassurance / incompleteness sentence for an empty digest (§10). Only
 * "you're all clear" language when every enabled source is Current; any
 * degraded source switches to explicit incompleteness naming the source.
 */
export function reassuranceLine(input: DigestInput): string {
  if (input.allSourcesCurrent) {
    return `No new recalls affect your household. Data is current as of ${formatDate(input.now)}.`;
  }
  const degraded = input.sources.filter((s) => s.state !== "current");
  const names = degraded.map((s) => SOURCE_LABEL[s.source]).join(", ");
  const detail =
    degraded.length > 0
      ? `${names} ${degraded.length === 1 ? "hasn't" : "haven't"} updated recently.`
      : "Some sources haven't updated recently.";
  return `Coverage incomplete — ${detail} No matches in the data we have.`;
}

/** One-line source-status footer, present on every digest (§10). */
export function sourceStatusFooter(input: DigestInput): string {
  if (input.allSourcesCurrent) {
    return `Data current as of ${formatDate(input.now)}.`;
  }
  const degraded = input.sources
    .filter((s) => s.state !== "current")
    .map((s) => `${SOURCE_LABEL[s.source]} (${s.state})`)
    .join("; ");
  return `Data coverage incomplete: ${degraded}.`;
}

/**
 * Plain-text digest body. HTML is a thin wrapper the send action can add; the
 * text version is what the tests assert against and what plain-text mail
 * clients render.
 */
export function renderDigestText(input: DigestInput): string {
  const sorted = sortDigestItems(input.items);
  const matches = sorted.filter(
    (i): i is DigestMatchItem => i.kind === "match",
  );
  const outbreaks = sorted.filter(
    (i): i is DigestOutbreakItem => i.kind === "outbreak",
  );
  const closures = sorted.filter(
    (i): i is DigestClosureItem => i.kind === "closure",
  );
  const outbreakClosures = sorted.filter(
    (i): i is DigestOutbreakClosureItem => i.kind === "outbreak_closure",
  );

  const lines: string[] = [];
  lines.push(`Food Recalls — daily digest for ${input.householdName}`);
  lines.push("");

  // Reassurance only when there are no alerts of EITHER kind (§10). Outbreak
  // matches count as alerts, so they suppress the "all clear" line too.
  if (matches.length === 0 && outbreaks.length === 0) {
    lines.push(reassuranceLine(input));
  }

  if (matches.length > 0) {
    lines.push(
      matches.length === 1
        ? "1 new recall affects your household:"
        : `${matches.length} new recalls affect your household:`,
    );
    lines.push("");
    for (const item of matches) {
      const reasons = item.matchedOn
        .map((d) => DIMENSION_LABEL[d])
        .join(", ");
      const possible = item.confidence === "possible" ? " (possible match)" : "";
      lines.push(`• [${SEVERITY_LABEL[item.severity]}] ${item.title} — ${item.firm}`);
      if (reasons) lines.push(`  Why: ${reasons}${possible}`);
      lines.push(`  ${item.url}`);
    }
  }

  // Outbreaks in their own "be aware" section (§11) — no risk-class label,
  // since CDC investigations often precede or never become a confirmed recall.
  if (outbreaks.length > 0) {
    if (matches.length > 0) lines.push("");
    lines.push("Active outbreaks to be aware of:");
    lines.push("");
    for (const item of outbreaks) {
      const reasons = item.matchedOn.map((d) => DIMENSION_LABEL[d]).join(", ");
      lines.push(`• ${item.title} — ${item.pathogen}`);
      if (reasons) lines.push(`  Why: ${reasons}`);
      lines.push(`  ${item.url}`);
    }
  }

  if (closures.length > 0 || outbreakClosures.length > 0) {
    lines.push("");
    lines.push("Resolved / updated since your last digest:");
    for (const item of closures) {
      lines.push(`• ${item.title} — ${LIFECYCLE_LABEL[item.lifecycle]}`);
      lines.push(`  ${item.url}`);
    }
    for (const item of outbreakClosures) {
      lines.push(`• ${item.title} — investigation closed`);
      lines.push(`  ${item.url}`);
    }
  }

  lines.push("");
  lines.push("—");
  lines.push(sourceStatusFooter(input));
  lines.push(
    "Data from openFDA, FSIS, and CDC — unvalidated and not an official alerting service. Always verify against the official notice.",
  );
  if (input.unsubscribeUrl) {
    lines.push(`Unsubscribe from these emails: ${input.unsubscribeUrl}`);
  }

  return lines.join("\n");
}
