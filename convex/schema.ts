import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// SPEC.md §6 — data model. Phase 5 (§2) is the public gate: Convex Auth
// (email OTP) plus per-household authorization on every function. `authTables`
// adds the auth-owned tables (users, authSessions, authAccounts,
// authVerificationCodes, authRefreshTokens, authVerifiers, authRateLimits).
// Preference data is now reachable only through the caller's own member row
// (convex/lib/auth.ts), never a shared secret.

export const lifecycleValidator = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("terminated"),
  v.literal("withdrawn"),
  v.literal("corrected"),
);

export const audienceValidator = v.union(
  v.literal("human"),
  v.literal("pet"),
  v.literal("unknown"),
);

export const hazardTypeValidator = v.union(
  v.literal("microbial"),
  v.literal("allergen"),
  v.literal("foreign_material"),
  v.literal("other"),
);

export const updateHistoryEntryValidator = v.object({
  date: v.string(),
  label: v.string(), // "Recall", "Update 1", ...
  summary: v.string(), // what changed (states added, class raised, etc.)
  contentHash: v.string(),
});

// Fields shared by the adapter output (NormalizedRecall) and the recalls table.
// The table adds firstSeenAt / updatedAt / updateHistory, which the upsert owns.
export const normalizedRecallFields = {
  source: v.union(v.literal("fda"), v.literal("fsis")),
  sourceId: v.string(),
  title: v.string(),
  firm: v.string(),
  classification: v.string(), // Class I / II / III (raw agency wording preserved)
  rawStatus: v.string(),
  lifecycle: lifecycleValidator,
  recallDate: v.string(), // ISO date
  productDesc: v.string(),
  states: v.array(v.string()), // normalized two-letter codes; 'US' = nationwide
  distribution: v.string(), // raw free text (chain matching, Phase 6)
  productCodes: v.array(v.string()),
  allergens: v.array(v.string()),
  audience: audienceValidator,
  hazardType: hazardTypeValidator,
  riskGroups: v.array(v.string()),
  imageUrl: v.optional(v.string()),
  imageSource: v.optional(
    v.union(v.literal("press"), v.literal("openfoodfacts"), v.literal("none")),
  ),
  sourceUrl: v.string(),
  raw: v.any(),
  contentHash: v.string(),
  linkPending: v.optional(v.boolean()),
};

// Fields shared by the adapter output (NormalizedOutbreak) and the outbreaks
// table, mirroring normalizedRecallFields above.
export const normalizedOutbreakFields = {
  source: v.literal("cdc"),
  sourceId: v.string(),
  title: v.string(),
  pathogen: v.string(),
  suspectedFood: v.optional(v.string()),
  states: v.array(v.string()),
  status: v.union(v.literal("active"), v.literal("resolved")),
  caseCount: v.optional(v.number()),
  hospitalizations: v.optional(v.number()),
  riskGroups: v.array(v.string()),
  imageUrl: v.optional(v.string()),
  sourceUrl: v.string(),
  raw: v.any(),
  contentHash: v.string(),
  // ISO date (YYYY-MM-DD) the investigation page itself was last updated —
  // CDC's outbreak pages carry no separate "outbreak start date" field, so
  // this doubles as both the feed's sort key and its displayed date, same
  // role recallDate plays for recalls.
  publishedAt: v.string(),
};

export default defineSchema({
  ...authTables,

  recalls: defineTable({
    ...normalizedRecallFields,
    updateHistory: v.array(updateHistoryEntryValidator),
    firstSeenAt: v.number(),
    updatedAt: v.number(),
    // Denormalized full-text search field (§10: archived alerts stay reachable
    // via search + scanner UPC checks). Built by the upsert from title/firm/
    // productDesc/productCodes; optional because pre-existing rows are filled
    // by a one-off backfill (convex/migrations.ts), not synchronously on deploy.
    searchText: v.optional(v.string()),
  })
    .index("by_source_id", ["source", "sourceId"])
    .index("by_recall_date", ["recallDate"])
    .index("by_lifecycle", ["lifecycle"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["lifecycle"],
    }),

  outbreaks: defineTable({
    ...normalizedOutbreakFields,
    updateHistory: v.array(updateHistoryEntryValidator),
    firstSeenAt: v.number(),
    updatedAt: v.number(),
    searchText: v.optional(v.string()), // see recalls.searchText
  })
    .index("by_source_id", ["source", "sourceId"])
    .index("by_published_at", ["publishedAt"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["status"],
    }),

  sourceHealth: defineTable({
    source: v.union(
      v.literal("fda"),
      v.literal("fsis"),
      v.literal("fda_rss"),
      v.literal("cdc"),
    ),
    state: v.union(
      v.literal("current"),
      v.literal("delayed"),
      v.literal("unavailable"),
    ),
    lastAttemptAt: v.number(),
    lastSuccessAt: v.number(),
    lastNewRecordAt: v.optional(v.number()),
    consecutiveFailures: v.number(),
    lastError: v.optional(v.string()),
  }).index("by_source", ["source"]),

  households: defineTable({
    name: v.string(),
    onboardingCompletedAt: v.optional(v.number()),
  }),

  householdPreferences: defineTable({
    householdId: v.id("households"),
    states: v.array(v.string()),
    brands: v.array(v.string()),
    keywords: v.array(v.string()),
    chains: v.array(v.string()), // fuzzy-match retailers (Phase 6)
    allergens: v.array(v.string()), // big-nine subset
    categories: v.object({
      humanFood: v.boolean(),
      petFood: v.boolean(),
      outbreaks: v.boolean(),
    }),
    pets: v.array(
      v.union(v.literal("dog"), v.literal("cat"), v.literal("other")),
    ),
    members: v.array(
      v.object({
        label: v.string(),
        labelPinned: v.boolean(), // §11: manual rename pins the label forever
        ageBand: v.union(
          v.literal("infant"),
          v.literal("child"),
          v.literal("adult"),
          v.literal("older_adult"),
        ),
        pregnant: v.optional(v.boolean()),
        immunocompromised: v.optional(v.boolean()),
      }),
    ),
  }).index("by_household", ["householdId"]),

  members: defineTable({
    householdId: v.id("households"),
    email: v.string(),
    // Phase 5 (§2): a member maps to a Convex Auth user once they sign in.
    // Optional because (a) the pilot household was seeded before auth existed
    // and claims its owner on first sign-in, and (b) an invited member exists
    // as an email-only row until they accept. `role` gates owner-only actions
    // (invites, deletion). Both are backfilled for pre-Phase-5 rows by
    // households.migratePilotMembers.
    authUserId: v.optional(v.id("users")),
    role: v.optional(v.union(v.literal("owner"), v.literal("member"))),
  })
    .index("by_household", ["householdId"])
    .index("by_auth_user", ["authUserId"])
    .index("by_email", ["email"]),

  // Household invitations (§2 "invitation flow with roles"). The owner emails
  // a tokenized invite; the invitee signs in and is bound to this household +
  // role. One row per outstanding/decided invitation.
  invites: defineTable({
    householdId: v.id("households"),
    email: v.string(), // invitee, lowercased
    role: v.union(v.literal("owner"), v.literal("member")),
    token: v.string(), // random, emailed; the accept credential
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    invitedByMemberId: v.id("members"),
    createdAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_household", ["householdId"])
    .index("by_email", ["email"]),

  notificationSettings: defineTable({
    memberId: v.id("members"),
    emailOptIn: v.boolean(),
    pushOptIn: v.boolean(),
    // Web Push subscription (PushSubscription.toJSON() shape). Cleared
    // automatically when the push service reports it gone (404/410) — see
    // convex/push.ts.
    pushSubscription: v.optional(
      v.object({
        endpoint: v.string(),
        keys: v.object({
          p256dh: v.string(),
          auth: v.string(),
        }),
        expirationTime: v.optional(v.union(v.number(), v.null())),
      }),
    ),
    urgencyThreshold: v.union(
      v.literal("class1_only"),
      v.literal("class1_plus_allergen"),
      v.literal("everything"),
    ),
    digestEnabled: v.boolean(),
    digestHour: v.number(),
    timezone: v.string(),
    // One-click email unsubscribe (§2). A per-member opaque token embedded in
    // every email footer; the public /unsubscribe route flips emailOptIn off
    // with no login. Backfilled for pre-Phase-5 rows by migratePilotMembers.
    unsubscribeToken: v.optional(v.string()),
    // Last time a daily digest actually went out to this member (Phase 2).
    // Guards the hourly digest cron against sending twice in the same local
    // day; empty digests leave no notificationsSent trace, so this is tracked
    // directly rather than inferred from the send log.
    lastDigestAt: v.optional(v.number()),
  })
    .index("by_member", ["memberId"])
    .index("by_unsubscribe_token", ["unsubscribeToken"]),

  notificationsSent: defineTable({
    memberId: v.id("members"),
    alertId: v.string(),
    alertType: v.union(v.literal("recall"), v.literal("outbreak")),
    contentHash: v.string(),
    channel: v.union(v.literal("email"), v.literal("push")),
    mode: v.union(v.literal("instant"), v.literal("digest")),
    sentAt: v.number(),
  }).index("by_member_alert", ["memberId", "alertId", "channel"]),

  // Pending items for each member's next daily email digest (Phase 2, §9).
  // Populated eagerly at alert-processing time so that preference changes —
  // which re-rank the feed but must NEVER retroactively notify (§7, §17.11) —
  // can't leak old alerts into a digest: only genuinely new/updated alerts and
  // closures ever enqueue here. Rows are drained (deleted) when the digest sends.
  digestQueue: defineTable({
    memberId: v.id("members"),
    alertId: v.string(),
    alertType: v.union(v.literal("recall"), v.literal("outbreak")),
    contentHash: v.string(), // revision this queue entry covers
    kind: v.union(v.literal("match"), v.literal("closure")),
    matchedOn: v.array(v.string()), // reason chips for the digest line
    confidence: v.union(v.literal("high"), v.literal("possible")),
    severity: v.union(
      v.literal("class1"),
      v.literal("class2"),
      v.literal("class3"),
      v.literal("unknown"),
    ),
    queuedAt: v.number(),
  })
    .index("by_member", ["memberId"])
    .index("by_member_alert", ["memberId", "alertId"]),

  // One row per FDA press-release RSS item (Phase 1 §3/§4). Press items
  // enrich matching enforcement records (photo, risk groups, notice URL) —
  // they are not recalls themselves. Unmatched relevant items are retried on
  // later ingest runs (press releases precede API records by days-to-weeks).
  pressItems: defineTable({
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    publishedAt: v.string(), // ISO date from pubDate
    companyName: v.string(),
    productType: v.string(), // e.g. "Food & Beverages" — non-food items recorded but never matched
    relevant: v.boolean(),
    imageUrl: v.optional(v.string()),
    riskGroups: v.array(v.string()),
    matchedRecallIds: v.array(v.id("recalls")),
    fetchedAt: v.number(),
    lastMatchAttemptAt: v.number(),
  }).index("by_guid", ["guid"]),

  bookmarks: defineTable({
    memberId: v.id("members"),
    alertId: v.string(),
    alertType: v.union(v.literal("recall"), v.literal("outbreak")),
    createdAt: v.number(),
  }).index("by_member", ["memberId"]),

  pantryItems: defineTable({
    householdId: v.id("households"),
    upc: v.string(),
    productName: v.optional(v.string()),
    brand: v.optional(v.string()),
    scannedAt: v.number(),
  }).index("by_household", ["householdId"]),
});
