import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentMember } from "./lib/auth";
import {
  matchRecall,
  severityOf,
  type MatchableAlert,
  type MatchablePrefs,
  type MatchDimension,
  type MatchResult,
  type Confidence,
  type Severity,
} from "./lib/matching";

// §8 feed personalization — "boost and badge, never bury." The §7 matcher
// (convex/lib/matching.ts) is pure and already covers recalls + outbreaks;
// this module is the reactive read layer that scopes it to the CALLER'S OWN
// household (never another's, §2) for the "For your household" pinned
// section, reason chips, the Feed nav badge, and per-alert Detail-page
// labeling. Deferred since Phase 2 — matcher output existed with no UI
// wiring (see README's Phase 2/4/5 entries) — built now alongside Phase 6
// because chain matches can't carry their required "possible" labeling in
// the feed/detail (§14) without this.

const ARCHIVE_AFTER_DAYS = 365; // mirrors recalls.ts / outbreaks.ts archive cutoff
// Bounded scans, not a full table `.collect()` — a growing recalls table must
// never blow Convex's per-query read budget (same concern documented for
// recalls.recentWithoutImage / press.relinkUnmatched). Personalization only
// needs to reach what's still relevant: active recalls of any age, or
// anything from the last year — the same universe the national feed shows.
const RECENT_SCAN_LIMIT = 500;
const ACTIVE_SCAN_LIMIT = 500;

function archiveCutoffIso(now: number): string {
  return new Date(now - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function candidateRecalls(ctx: QueryCtx): Promise<Doc<"recalls">[]> {
  const cutoff = archiveCutoffIso(Date.now());
  const recent = await ctx.db
    .query("recalls")
    .withIndex("by_recall_date")
    .order("desc")
    .take(RECENT_SCAN_LIMIT);
  const active = await ctx.db
    .query("recalls")
    .withIndex("by_lifecycle", (q) => q.eq("lifecycle", "active"))
    .take(ACTIVE_SCAN_LIMIT);
  const byId = new Map<string, Doc<"recalls">>();
  for (const r of [...recent, ...active]) byId.set(r._id, r);
  return [...byId.values()].filter((r) => r.lifecycle === "active" || r.recallDate >= cutoff);
}

async function candidateOutbreaks(ctx: QueryCtx): Promise<Doc<"outbreaks">[]> {
  const cutoff = archiveCutoffIso(Date.now());
  const all = await ctx.db.query("outbreaks").withIndex("by_published_at").order("desc").take(300);
  return all.filter((o) => o.status === "active" || o.publishedAt >= cutoff);
}

/**
 * Outbreaks carry no productDesc/firm/allergens (§7 "outbreak records are
 * thin") and are always audience 'human' — gated by the household's
 * `outbreaks` toggle upstream of the matcher, not by matchRecall itself
 * (matching.test.ts documents this split; matchRecall only knows
 * audience-based humanFood/petFood gating).
 */
function outbreakAsAlert(o: Doc<"outbreaks">): MatchableAlert {
  return {
    audience: "human",
    states: o.states,
    productDesc: "",
    firm: "",
    allergens: [],
    riskGroups: o.riskGroups,
    suspectedFood: o.suspectedFood,
  };
}

export type MatchInfo = {
  matchedOn: MatchDimension[];
  matchedDetails: Partial<Record<MatchDimension, string[]>>;
  confidence: Confidence;
  severity: Severity;
};

/** Single-alert match result (matchForAlert) — no card payload, the Detail page already has the doc. */
export type MatchedEntry = MatchInfo & { alertId: string; alertType: "recall" | "outbreak" };

// The exact fields RecallCard/OutbreakCard render (components/RecallCard.tsx,
// components/OutbreakCard.tsx) — trimmed rather than the full doc (no `raw`,
// `distribution`, `productCodes`, etc.) since myMatches embeds this alongside
// match metadata so the "For your household" section needs no follow-up query.
type RecallCardFields = Pick<
  Doc<"recalls">,
  | "_id"
  | "recallDate"
  | "states"
  | "productDesc"
  | "firm"
  | "hazardType"
  | "classification"
  | "lifecycle"
  | "updateHistory"
  | "imageUrl"
>;
type OutbreakCardFields = Pick<
  Doc<"outbreaks">,
  | "_id"
  | "publishedAt"
  | "states"
  | "pathogen"
  | "suspectedFood"
  | "title"
  | "status"
  | "caseCount"
  | "hospitalizations"
  | "updateHistory"
  | "imageUrl"
>;

export type MatchedFeedEntry = MatchInfo &
  ({ alertType: "recall"; recall: RecallCardFields } | { alertType: "outbreak"; outbreak: OutbreakCardFields });

const SEVERITY_RANK: Record<Severity, number> = {
  class1: 0,
  class2: 1,
  class3: 2,
  unknown: 3,
};

/**
 * §8: "ranked by severity, then match confidence, then recency. Risk-group
 * and allergen matches rank above state-only matches." Health-based matches
 * (allergen/risk-group) are the strongest personal-relevance signal, so they
 * sort ahead of severity; confidence and recency break remaining ties.
 */
function rankKey(entry: MatchInfo, date: string): [number, number, number, string] {
  const hasHealthMatch =
    entry.matchedOn.includes("allergen") || entry.matchedOn.includes("risk_group");
  return [
    hasHealthMatch ? 0 : 1,
    SEVERITY_RANK[entry.severity],
    entry.confidence === "high" ? 0 : 1,
    date,
  ];
}

function entryDate(entry: MatchedFeedEntry): string {
  return entry.alertType === "recall" ? entry.recall.recallDate : entry.outbreak.publishedAt;
}

function compareEntries(a: MatchedFeedEntry, b: MatchedFeedEntry): number {
  const ka = rankKey(a, entryDate(a));
  const kb = rankKey(b, entryDate(b));
  for (let i = 0; i < 3; i++) {
    const diff = (ka[i] as number) - (kb[i] as number);
    if (diff !== 0) return diff;
  }
  // Recency: newer date first (descending).
  return ka[3] < kb[3] ? 1 : ka[3] > kb[3] ? -1 : 0;
}

/** The caller's own household prefs, or null if signed out / not onboarded. */
async function myPrefs(
  ctx: QueryCtx,
): Promise<{ member: Doc<"members">; prefs: Doc<"householdPreferences"> } | null> {
  const member = await getCurrentMember(ctx);
  if (!member) return null;
  const prefs = await ctx.db
    .query("householdPreferences")
    .withIndex("by_household", (q) => q.eq("householdId", member.householdId))
    .unique();
  if (!prefs) return null;
  return { member, prefs };
}

function matchInfo(severity: Severity, match: MatchResult): MatchInfo {
  return {
    matchedOn: match.matchedOn,
    matchedDetails: match.matchedDetails,
    confidence: match.overallConfidence,
    severity,
  };
}

const RECALL_CARD_FIELDS = [
  "_id",
  "recallDate",
  "states",
  "productDesc",
  "firm",
  "hazardType",
  "classification",
  "lifecycle",
  "updateHistory",
  "imageUrl",
] as const;

function toRecallCardFields(doc: Doc<"recalls">): RecallCardFields {
  return Object.fromEntries(RECALL_CARD_FIELDS.map((k) => [k, doc[k]])) as unknown as RecallCardFields;
}

const OUTBREAK_CARD_FIELDS = [
  "_id",
  "publishedAt",
  "states",
  "pathogen",
  "suspectedFood",
  "title",
  "status",
  "caseCount",
  "hospitalizations",
  "updateHistory",
  "imageUrl",
] as const;

function toOutbreakCardFields(doc: Doc<"outbreaks">): OutbreakCardFields {
  return Object.fromEntries(OUTBREAK_CARD_FIELDS.map((k) => [k, doc[k]])) as unknown as OutbreakCardFields;
}

/**
 * Every current recall/outbreak matched against the caller's household,
 * ranked per §8, with the card fields RecallCard/OutbreakCard need embedded
 * — the "For your household" section renders straight from this, no
 * follow-up query. Null when signed out or not yet onboarded — the national
 * feed stays fully public/unpersonalized in that case (§2).
 */
export const myMatches = query({
  args: {},
  handler: async (ctx): Promise<MatchedFeedEntry[] | null> => {
    const found = await myPrefs(ctx);
    if (!found) return null;
    const prefs: MatchablePrefs = found.prefs;

    const entries: MatchedFeedEntry[] = [];

    for (const recall of await candidateRecalls(ctx)) {
      const match = matchRecall(recall, prefs);
      if (!match.matched) continue;
      entries.push({
        alertType: "recall",
        recall: toRecallCardFields(recall),
        ...matchInfo(severityOf(recall.classification), match),
      });
    }

    if (prefs.categories.outbreaks) {
      for (const outbreak of await candidateOutbreaks(ctx)) {
        const match = matchRecall(outbreakAsAlert(outbreak), prefs);
        if (!match.matched) continue;
        // §4: active outbreaks are treated as Class I equivalent for alerting.
        const severity: Severity = outbreak.status === "active" ? "class1" : "unknown";
        entries.push({
          alertType: "outbreak",
          outbreak: toOutbreakCardFields(outbreak),
          ...matchInfo(severity, match),
        });
      }
    }

    return entries.sort(compareEntries);
  },
});

/**
 * Match info for a single alert against the caller's household — powers the
 * Detail page's reason chips / "possible match" chain copy without scanning
 * the whole feed. Null when signed out, not onboarded, or the alert doesn't
 * match (nothing to show).
 */
export const matchForAlert = query({
  args: {
    alertId: v.string(),
    alertType: v.union(v.literal("recall"), v.literal("outbreak")),
  },
  handler: async (ctx, args): Promise<MatchedEntry | null> => {
    const found = await myPrefs(ctx);
    if (!found) return null;
    const prefs: MatchablePrefs = found.prefs;

    if (args.alertType === "recall") {
      const recall = await ctx.db.get(args.alertId as Id<"recalls">);
      if (!recall) return null;
      const match = matchRecall(recall, prefs);
      if (!match.matched) return null;
      return { alertId: recall._id, alertType: "recall", ...matchInfo(severityOf(recall.classification), match) };
    }

    if (!prefs.categories.outbreaks) return null;
    const outbreak = await ctx.db.get(args.alertId as Id<"outbreaks">);
    if (!outbreak) return null;
    const match = matchRecall(outbreakAsAlert(outbreak), prefs);
    if (!match.matched) return null;
    const severity: Severity = outbreak.status === "active" ? "class1" : "unknown";
    return { alertId: outbreak._id, alertType: "outbreak", ...matchInfo(severity, match) };
  },
});
