# Food Recall Tracker — Build Spec

A household food-safety monitoring tool: pulls federal recall and outbreak data, enriches
and filters it to what actually affects your household, and alerts you. PWA dashboard with
opt-in email and web push notifications.

This document is the guiding spec for the build. All major decisions are settled (see §17);
do not relitigate them mid-build. When building the frontend, use the `pwa` skill (with
`frontend-design` alongside it); build to the skill's **Core** tier for Phase 1 and
**Production-grade** by Phase 3.

---

## 1. Goal

Answer three questions the government sites make hard:

1. Is there a new food recall or active outbreak?
2. Does it affect *my household* — my state, the brands/products we buy, our allergens,
   our members' risk groups, our pets, or the stores we shop at?
3. If nothing affects us, can I trust that silence?

Question 3 is a system contract, not a slogan: the app may only express reassurance when
it can prove its data is current (§10).

## 2. Product model, rollout posture, and access model

**Personal-first, public-maybe-later.** Built and deployed for one household (two adults,
one child) initially; schema and architecture stay multi-household from day one.

- The core entity is a **household**, not a user. Preferences, members, allergens, and pets
  belong to the household; notification channels belong to individual members.
- **Phases 0–4 are an explicitly private pilot.** No external member access, no public
  signup, no public marketing of the deployed URL. Because household preferences include
  sensitive information (a child's age band, allergies, pregnancy/immunocompromise flags,
  emails), all preference-reading Convex functions must be non-public (internal functions
  or gated by a shared-secret/env check) during the pilot. Never expose preference data
  through unauthenticated public queries, even "temporarily."
- **Phase 5 is the public-launch gate.** Going public requires, at minimum: Convex Auth
  with email verification, household-scoped authorization on every query/mutation with
  tests, invitation flow with roles (owner/member), one-click email unsubscribe, account
  deletion and data export, and **push/lock-screen redaction** — push notification text
  contains product name + severity only, never sensitive match reasons ("immunocompromised
  match" appears in-app, not on a lock screen).
- **Brand identity (settled): "Don't Eat" — tagline "Food recalls that apply to you and your family."**
  Existing recall apps brand around *recalls* (the data); this product brands around *the
  household* (the protection). Voice: calm, plain-spoken, reassuring — the app tells you
  two things: is there a new recall, and does it affect you. Full visual tokens in §12.

**Competitive posture (from research on existing iOS recall apps):** the incumbents paywall
relevance (state filters, bookmarks, recall timelines behind subscriptions), require
accounts for basic notifications, run banner ads, and offer no preference model beyond
on/off toggles. This product is ad-free, personal, and treats relevance as the core free
experience.

## 3. Data sources

| Source | Covers | Format | Freshness | Notes |
|---|---|---|---|---|
| **openFDA Food Enforcement API** | Packaged foods, produce, supplements, **pet food** | JSON | Updated weekly | `https://api.fda.gov/food/enforcement.json`. Register a free API key. |
| **USDA FSIS Recall API** | Meat, poultry, egg products | JSON | Near real-time | FSIS regulates these; FDA does not. |
| **FDA Recalls RSS + press releases** | Same as FDA API, richer free text + **product photos** + "who's at risk" text | RSS/HTML | As published | Ingested in Phase 1 for images and risk-group text; also feeds chain matching (Phase 6). |
| **CDC active outbreak investigations** | Foodborne illness outbreaks (may precede or never become recalls) | HTML/feed scrape | As published | No clean structured API. Separate record type (see §6). |
| **Open Food Facts API** | Product images by UPC | JSON | n/a | Free/open. Image fallback only, keyed by UPC. |

### Product photo strategy

Photos transform feed scannability. Fallback chain:

1. Image from the FDA/FSIS press release or recall notice (primary; usually present).
2. Open Food Facts lookup by UPC when the notice has no usable image.
3. Category illustration placeholder when neither yields an image: a food-category
   illustration on a soft tinted background (tint keyed to hazard type), per the
   established brand style.

Store the resolved image URL (or Convex file storage ID if mirroring) plus an
`imageSource` field so provenance is known. Real press-release photography is
inconsistent (odd aspect ratios, white studio shots, photographed labels); card and
detail image containers must handle this gracefully — object-fit contain within the
tinted container, never stretched or cropped to illegibility.

### Honest limitations (carry into UI copy)

- **Store/chain matching** is best-effort fuzzy text matching. Label "possible — verify."
- **Outbreak records are thin** — often no brand, UPC, or firm. Matching degrades to state +
  keyword. UI framing: outbreaks are *"be aware right now"*; recalls are *"check your stuff."*
- **Scanner results are best-effort**: UPCs are inconsistently present in recall records, so
  scan results say **"no known recall"** — never "safe" — and fall back to brand/firm matching
  (including a "same manufacturer has other active recalls" check).
- openFDA states its data is unvalidated and not intended as a public alerting source.
  Surface a disclaimer; always deep-link to the official source.

## 4. Architecture

```
[Convex cron jobs -> actions]
   ├── openFDA food enforcement     (daily)
   ├── FSIS recall API              (every 2-4h)
   ├── FDA RSS / press releases     (every 2-4h; images, risk text, retailer text)
   └── CDC outbreak pages           (every 2-4h; Phase 4)
            |
   [Source adapters: normalize + ENRICH + dedupe]   <- center of gravity
     (internal mutations; upsert on (source, sourceId);
      content hash per revision; sourceHealth updated every run)
            |
        [Convex database]
            |
   +--------+-------------------------+
   |                                  |
[Matching engine]              [Reactive queries]
(alert x household prefs;        (live-updating feed,
 emits match reasons,             detail, timeline,
 confidence, severity)            source-health banner)
   |
[Notification dispatch]
(Convex actions: Resend email + web push;
 decision matrix in §9; hard floor; per-revision dedupe log)
```

### Source adapters

Each source (openFDA, FSIS, FDA RSS, CDC) is a self-contained adapter with the same
contract:

- **Identity:** emits `(source, sourceId)`; press-release records link to their API record
  by recall/event number when present, else create a provisional record flagged
  `linkPending`.
- **Revisioning:** computes a `contentHash` over the material fields (classification,
  states, allergens, status, productDesc, productCodes). Hash unchanged → touch
  `updatedAt` only. Hash changed → append an `updateHistory` entry and re-run matching.
- **Health reporting:** every run (success, empty, or failure) updates the `sourceHealth`
  record (§10).
- **Backfill:** initial load pages politely through history (openFDA: `limit` + `skip`,
  1000/call); chunked via the Convex scheduler to respect action time limits.

### The enrichment layer

On ingest, each record gets a tagging pass:

1. **Allergen extraction** — scan reason/product text for the FDA big nine (milk, eggs,
   fish, crustacean shellfish, tree nuts, peanuts, wheat, soy, sesame) → `allergens: string[]`.
2. **Audience classification** — human food vs. pet food from product description and firm
   name → `audience: 'human' | 'pet' | 'unknown'`. Unknowns display under human.
3. **Hazard type** — `hazardType: 'microbial' | 'allergen' | 'foreign_material' | 'other'`
   from reason text. Drives card iconography and a severity-style filter.
4. **Risk groups** — extract at-risk populations from press-release "who's at risk" text →
   `riskGroups: string[]` from a normalized set: `infant`, `child`, `pregnant`,
   `older_adult`, `immunocompromised`.
5. **State normalization** — "Nationwide," full names, abbreviations → canonical
   two-letter codes; `'US'` = nationwide.
6. **Severity + lifecycle normalization** — Class I/II/III preserved; active outbreaks
   treated as Class I equivalent for alerting; raw status mapped to the lifecycle in §10.
7. **Image resolution** — per the photo fallback chain above.

**Enrichment error bias (deliberate):** allergen tagging biases toward false positives (an
extra alert beats a missed peanut recall); pet-food classification biases toward false
negatives (mislabeled pet food shows to everyone rather than disappearing). Keep raw
records; make tags correctable.

## 5. Stack

- **Frontend:** Next.js PWA + Tailwind, per `pwa` skill non-negotiables (mobile-first, valid
  manifest, service worker with custom offline page, no cold permission prompts, Lighthouse
  installability passing). Hosted on Vercel.
- **Backend/Database:** **Convex** — schema, queries, mutations, actions, file storage.
  Reactive queries give the feed and detail views live updates for free.
- **Scheduled ingest:** **Convex cron jobs** (`crons.ts`) triggering actions, then internal
  mutations for normalize/enrich/upsert.
- **Auth (Phase 5):** **Convex Auth.**
- **Email:** Resend, called from Convex actions (or the Convex Resend component).
- **Push:** Web Push API + VAPID. Subscriptions stored in Convex; sends via the `web-push`
  library inside a Node runtime action (`"use node"`).
- **External HTTP:** all third-party fetches happen in Convex **actions**, never in
  queries/mutations.

## 6. Data model (Convex schema, conceptual)

Convex documents with validators; `v.union(v.literal(...))` for the enum-like fields.
Indexes noted where they matter.

```ts
recalls: {
  source: 'fda' | 'fsis',
  sourceId: string,                 // upsert key with source
  title: string,
  firm: string,
  classification: string,          // Class I / II / III
  rawStatus: string,               // as reported by source
  lifecycle: 'active' | 'completed' | 'terminated' | 'withdrawn' | 'corrected',
  recallDate: string,              // ISO date
  productDesc: string,
  states: string[],                // normalized; 'US' = nationwide
  distribution: string,            // raw free text (chain matching)
  productCodes: string[],          // UPCs / lots
  allergens: string[],             // enriched
  audience: 'human' | 'pet' | 'unknown',
  hazardType: 'microbial' | 'allergen' | 'foreign_material' | 'other',
  riskGroups: string[],            // enriched from press text
  imageUrl?: string,
  imageSource?: 'press' | 'openfoodfacts' | 'none',
  sourceUrl: string,
  raw: any,                        // full original record
  contentHash: string,             // hash of material fields; revision identity
  linkPending?: boolean,           // press record awaiting API-record link
  updateHistory: Array<{           // powers the Timeline view
    date: string,
    label: string,                 // "Recall", "Update 1", ...
    summary: string,               // what changed (states added, class raised, etc.)
    contentHash: string,
  }>,
  firstSeenAt: number,
  updatedAt: number,
}
// .index('by_source_id', ['source', 'sourceId'])
// .index('by_recall_date', ['recallDate'])
// .index('by_lifecycle', ['lifecycle'])

outbreaks: {
  source: 'cdc',
  sourceId: string,
  title: string,
  pathogen: string,
  suspectedFood?: string,
  states: string[],
  status: 'active' | 'resolved',
  caseCount?: number,
  hospitalizations?: number,       // powers the red impact line
  riskGroups: string[],
  imageUrl?: string,
  sourceUrl: string,
  raw: any,
  contentHash: string,
  updateHistory: Array<{ date: string, label: string, summary: string, contentHash: string }>,
  firstSeenAt: number,
  updatedAt: number,
}
// Unified "alerts" read model = query merging both tables with alertType discriminator.

sourceHealth: {                    // one record per source; see §10
  source: 'fda' | 'fsis' | 'fda_rss' | 'cdc',
  state: 'current' | 'delayed' | 'unavailable',
  lastAttemptAt: number,
  lastSuccessAt: number,
  lastNewRecordAt?: number,
  consecutiveFailures: number,
  lastError?: string,
}

households: {
  name: string,
  onboardingCompletedAt?: number,
}

householdPreferences: {
  householdId: Id<'households'>,
  states: string[],
  brands: string[],
  keywords: string[],              // "spinach", "ground beef"
  chains: string[],                // fuzzy-match retailers (Phase 6)
  allergens: string[],             // big-nine subset
  categories: {
    humanFood: boolean,
    petFood: boolean,
    outbreaks: boolean,
  },
  pets: Array<'dog' | 'cat' | 'other'>,
  members: Array<{                 // age bands, not birthdays; minimal + non-creepy
    label: string,                 // "Adult 1", "Kid", freeform
    ageBand: 'infant' | 'child' | 'adult' | 'older_adult',
    pregnant?: boolean,
    immunocompromised?: boolean,
  }>,
}

members: {                         // maps to Convex Auth users in Phase 5
  householdId: Id<'households'>,
  email: string,
  // authUserId, role ('owner' | 'member') added in Phase 5
}

notificationSettings: {            // per MEMBER
  memberId: Id<'members'>,
  emailOptIn: boolean,
  pushOptIn: boolean,
  pushSubscription?: any,          // Web Push subscription object
  urgencyThreshold: 'class1_only' | 'class1_plus_allergen' | 'everything',
                                   // default 'class1_plus_allergen' ("Recommended")
  digestEnabled: boolean,          // default true
  digestHour: number,              // local hour, default 17
  timezone: string,                // IANA tz; single-household v1 can hardcode
}

notificationsSent: {               // per-revision dedupe log
  memberId: Id<'members'>,
  alertId: string,                 // recall or outbreak _id
  alertType: 'recall' | 'outbreak',
  contentHash: string,             // revision this send covered
  channel: 'email' | 'push',
  mode: 'instant' | 'digest',
  sentAt: number,
}
// .index('by_member_alert', ['memberId', 'alertId', 'channel'])

bookmarks: {
  memberId: Id<'members'>,
  alertId: string,
  alertType: 'recall' | 'outbreak',
  createdAt: number,
}
// .index('by_member', ['memberId'])

pantryItems: {                     // Phase 7 (scanner)
  householdId: Id<'households'>,
  upc: string,
  productName?: string,
  brand?: string,
  scannedAt: number,
}
```

## 7. Matching logic

For each new or materially updated alert, match against each household. A match fires on
**any** enabled dimension (OR logic), gated by category toggles:

- **State:** `prefs.states ∩ alert.states` non-empty, or nationwide.
- **Brand/keyword:** case-insensitive match against `productDesc` + `firm`
  (+ `suspectedFood` for outbreaks).
- **Allergen:** `prefs.allergens ∩ alert.allergens` non-empty. High confidence.
- **Risk group:** household member/pregnancy/immunocompromised flags ∩ `alert.riskGroups`.
- **Pet:** `audience === 'pet'` and household has pets.
- **Category gate:** audience/type must be enabled in `prefs.categories`. **The gate is
  absolute: disabled categories are never evaluated, and no rule — including the hard
  floor — overrides it.** Disabling a category is the household's most explicit statement
  of intent.
- **Chain (Phase 6):** fuzzy/substring match against `distribution` + press text, flagged
  `confidence: 'possible'`. Chain-only matches never notify instantly.
- **Pantry (Phase 7):** `pantryItems.upc ∩ alert.productCodes`, plus same-firm soft match.

**The matcher emits structured output:** `matchedOn: ['state','allergen','risk_group']`,
per-dimension confidence, and severity. This single payload drives feed ranking, reason
chips, notification copy, and instant-vs-digest routing.

**Preference changes re-rank; they do not re-notify.** When household preferences change,
matching re-runs against existing active alerts so the "For your household" feed section
updates immediately — but no notifications fire for previously existing alerts. Only
genuinely new alerts or material updates notify.

## 8. Feed personalization — "boost and badge, never bury"

One feed; nothing is hidden. Matched items get elevated and visually distinguished:

- **"For your household"** pinned section at the top: matched alerts, ranked by severity,
  then match confidence, then recency. Risk-group and allergen matches rank above
  state-only matches.
- **Reason chips** on matched cards: "Your state," "Allergen: milk," "Publix," "Pet,"
  "Infant risk" — rendered directly from `matchedOn`.
- Full national feed below, reverse-chronological, filter chips (state, category, hazard
  type, allergen, "matched us").
- Rationale: silently filtering a safety feed means a user never learns about the
  nationwide Class I recall that didn't match their keywords. Relevance is a lens, not a
  wall.

## 9. Notification model

Three knobs, not thirty:

1. **Urgency threshold** (per member): `class1_only` / `class1_plus_allergen` (default,
   "Recommended") / `everything`. Everything below threshold rolls into the daily digest.
2. **Category toggles** (per household): human food / pet food / outbreaks.
3. **Channels** (per member): email and/or push, explicit opt-in each.

Presets: **Recommended** (default), **Everything, instantly**, **Digest only**.

**Hard floor:** Class I + household-allergen match, or Class I + risk-group match, always
goes instant on any opted-in channel regardless of threshold — *within enabled categories
only* (the category gate in §7 is absolute).

**Push content:** product name, severity, and a deep link. Match reasons involving health
attributes (allergens, pregnancy, immunocompromise, risk groups) appear in-app only, never
in push/lock-screen text.

### Alert decision matrix

"Material update" = `contentHash` changed. Per-member dedupe: a (member, alert, channel,
contentHash) tuple is sent at most once — retries and re-runs are idempotent.

| Event | Category enabled? | Match & confidence | Instant | Digest | Feed/Timeline |
|---|---|---|---|---|---|
| New alert | No | — | Never | Never | National feed only |
| New alert | Yes | Hard-floor match (Class I + allergen/risk-group) | Always | — | Household section + chips |
| New alert | Yes | Meets member threshold | Yes | — | Household section + chips |
| New alert | Yes | Matches, below threshold | No | Next digest | Household section + chips |
| New alert | Yes | Chain-only ('possible') | Never | Next digest, labeled "possible" | Household section, "possible" chip |
| Material update | Yes | Still/newly matches | Re-evaluate as new for this revision; notify per rows above if this revision not yet sent | Same | Timeline entry + UPDATE badge |
| Immaterial update (hash unchanged) | — | — | Never | Never | `updatedAt` touch only; no timeline entry |
| Preference change → old alert newly matches | Yes | Any | Never | Never | Appears in household section immediately |
| Lifecycle → completed/terminated | Yes | Was previously notified to member | Never | One closure line in next digest ("resolved") | Timeline entry; drops from household pinned section |
| Lifecycle → completed/terminated | Yes | Never notified | Never | Never | Timeline entry only |
| Lifecycle → withdrawn/corrected | Yes | Was previously notified | Never | Closure/correction line in next digest | Marked withdrawn; timeline entry |

**Daily digest:** sends at each member's `digestHour`, containing that member's unsent
matched items since their previous digest (per the dedupe log), closure lines per the
matrix, and the data-health status per §10. **Sends even when empty** — the empty digest is
the trust mechanism — but its reassurance copy is governed by §10.

**Push permission UX** (per `pwa` skill rule 8): never fire the browser prompt cold. Show an
in-app explainer with a **preview of a real alert**, then trigger the native prompt only on
explicit "Enable alerts." A denied browser prompt is nearly unrecoverable. **The explainer
copy must match the member's selected preset** — it may only promise restraint ("we only
interrupt you for urgent recalls") when Recommended is selected; under "Everything,
instantly" it describes exactly that, and under "Digest only" it pitches the daily email
(with an email preview) instead of a lock-screen preview. The preview never contains
health-attribute match reasons.

## 10. Data-health contract and recall lifecycle

The app may only express reassurance it can prove. Two mechanisms:

### Source health

Every adapter run updates `sourceHealth`. States, using each source's polling interval:

- **Current** — last successful run within 2× polling interval, no parse anomalies.
- **Delayed** — last success older than 2× polling interval but within 7 days, OR the run
  succeeded with an anomaly (e.g., CDC/RSS parse returned zero records where records
  previously existed).
- **Unavailable** — no success in 7+ days, or 5+ consecutive failures.

Behavior:

- Failures retry with backoff on the next scheduled runs; entering Delayed or Unavailable
  triggers a self-alert to the operator (log + operator email).
- **Reassurance gate:** the phrases "nothing affects your household" / "you're all clear"
  (digest and feed empty-states) are permitted only when **all enabled sources are
  Current**. If any source is Delayed/Unavailable, copy switches to explicit incompleteness:
  "Coverage incomplete — USDA meat & poultry data hasn't updated since Tuesday. No matches
  in the data we have." 
- The feed shows a persistent, dismissible banner while any source is degraded; the digest
  always includes a one-line source status footer ("Data current as of …" or the degraded
  message).
- Beyond the banner, the app chrome carries an always-visible source-status indicator:
  a "Current" pill in the mobile header and a status line in the desktop sidebar footer,
  switching to an amber "Delayed"/"Unavailable" state when degraded. Status is ambient,
  not just an interruption.

### Recall lifecycle

Raw source statuses map to: **active** (ongoing), **completed**, **terminated**,
**withdrawn**, **corrected**. Lifecycle transitions are material updates (they change the
hash) and follow the decision matrix: closure appears in digests only for members who were
previously notified; nothing about a resolution interrupts anyone instantly. Alerts older
than 12 months and non-active are **archived**: excluded from the default feed and
matching, still reachable via search and pantry/scanner UPC checks.

## 11. Onboarding and household setup

Household setup is a **multi-step questionnaire**, not a settings dump. It runs at first
launch (Phase 5; in the pilot, the same steps exist as the seed script's structure) and is
**re-runnable anytime from the Household tab ("Redo setup"), prefilled with current
answers.** Each step is skippable except Step 1; everything is editable individually in the
Household tab afterward.

1. **Where you are** — state(s) (multi-select, primary state first), optional favorite
   stores. Required.
2. **Who's in your household** — add members by age band (infant / child / adult / 65+),
   optional pregnancy and immune-system flags, pets (dog / cat / other). Member behavior
   rules:
   - **Labels derive, then pin.** Default labels derive from the age band ("Adult",
     "Infant", numbered only for duplicates: "Adult 2") and re-derive when the age band
     changes. Once a user manually renames a member, the label is pinned and never
     auto-renames. Labels carry a visible edit affordance (pencil icon, inline edit).
   - **Conditional flags.** The Pregnant toggle renders only for Adult and 65+ age bands.
     Weakened-immune-system renders for all ages.
   - **Deferred privacy notes.** The privacy helper text appears when a health flag is
     switched on (not statically under every toggle): "Used only to flag recalls that
     name at-risk groups. Never shown in notifications. Removable anytime."
3. **Allergens** — big-nine multi-select, with its own (allergen-specific) helper text:
   "Used only to flag recalls containing these allergens. Never shown in notifications.
   Removable anytime."
4. **How you want to hear about it** — preset choice (Recommended pre-selected /
   Everything / Digest only), channel opt-ins. Push uses the explainer + preview flow from
   §9; the native prompt fires only if they enable push.
5. **Summary — "What counts as relevant to your household"** — a readable recap of
   everything chosen ("Recalls in NC · milk & peanut allergens · 1 infant · 1 dog ·
   Recommended alerts"). The banner sentence and the detail rows must be generated from
   the same stored values — they can never disagree. This same summary is the read-only
   Household tab view in Phases 1–4.

### Plain-language copy rules

- Never render agency jargon bare. "Class I" → "**High risk** — reasonable chance of
  serious harm (FDA Class I)"; Class II → "Moderate risk"; Class III → "Low risk". "Firm" →
  "company". 
- Chain matches: "**Possible match** — the recall notice mentions Publix, but government
  data doesn't confirm specific stores. Check the official notice."
- Scanner: "**No known recall** for this barcode. Recalls don't always include barcodes,
  so also check brand and lot number." 
- Outbreak framing: "**Be aware** — investigators haven't confirmed a specific product
  yet" vs. recall framing "**Check your kitchen**."

## 12. Frontend (PWA)

Built with `pwa` + `frontend-design` skills. Phase 1 targets **Core** tier; Phase 3+ targets
**Production-grade** (push, Lighthouse 90+).

**Navigation (bottom tab bar, 4 tabs):**

1. **Feed** — personalized feed per §8, plus the source-health banner per §10. The Feed
   nav item carries a badge with the count of **active household-matched alerts** (not
   unread counts — the badge reflects current relevance, and clears as matched alerts
   resolve or archive, not on view).
2. **Scanner** — Phase 7; tab appears when built.
3. **Saved** — bookmarked alerts ("check the freezer when I get home" / shopping-trip use).
4. **Household** — Phases 1–4: **read-only** summary of the seeded preferences (the §11
   Step-5 recap) + notification settings view. Phase 5: fully editable members, allergens,
   pets, states, stores, brands, notification settings, and "Redo setup." No separate
   Settings tab; Household *is* settings.

**Card anatomy:** product photo (or hazard-styled placeholder), date, geography badge
("8 states" / "Nationwide"), product name, brand/company, retailer when known, hazard line
with hazard-type icon, plain-language risk level per §11, red impact line when human impact
exists ("12 sick · 4 hospitalized"), UPDATE badge when `updateHistory.length > 1`, reason
chips when matched.

**Brand identity & tokens:** App name **Recall Log**; tagline "Recalls that actually apply
to you." Typography: **Public Sans** throughout — heavy weight (Bold/Black) for the
wordmark and section headlines, Regular for dashboard UI and body text. Palette
(authoritative values, from the prototype's CSS theme):

| Token | Role | Value |
|---|---|---|
| `--primary` | Brand primary (blue) | `#2b7ea7` |
| `--accent` | Accent (amber) | `#f3b838` |
| `--background` | App background (cool off-white) | `#F4F7F9` |
| `--card` / surface | Cards / panels | `#FFFFFF` |
| `--secondary` | Tinted fills (banners, chips) | `#E5F2F8` |
| `--foreground` / ink | Body text | `#121d1d` |
| `--muted-foreground` | Secondary text | `#6b7174` |
| `--destructive` | Danger / Class I red | `#cc272e` |
| `--border` | Hairlines | `rgba(18, 29, 29, 0.09)` |
| `--radius` | Base corner radius | `0.625rem` |

Note: cards are white on a tinted background (not white-on-white). The severity system
below maps onto these tokens: Class I uses `--destructive`, Class II uses `--accent`.
**v1 ships light mode only** — the prototype's dark-mode block is unbranded scaffold
output and must not ship as-is; a branded dark theme is a post-v1 design task.

**Severity color system:** severity colors are quarantined from
the brand palette — brand primary/accent never signal danger, and severity hues carry
meaning only. Class I: solid red (`#cc272e`). Class II: solid amber (`#f3b838`). Class
III: slate. Resolved: neutral gray. Outbreak: solid deep orange — urgent, but
distinguishable from Class I at a glance, matching the "be aware" vs. "check your
kitchen" framing. The UPDATE badge is an outlined amber pill (border + text, transparent
fill) so it never reads as Class II severity when the two co-occur on a card.

**Detail view:** photo, summary, "Who's at risk?" section, affected states, product list
with lot/UPC codes, **Timeline** (vertical: Recall → Update 1 → Update 2, rendered from
`updateHistory`), company contact info, bookmark + share actions, prominent "View official
source" link.

**Sharing:** Web Share API with a pre-written message ("Just saw this recall — worth
double-checking") + deep link.

**Empty/quiet states are first-class design work** and obey the §10 reassurance gate:
all-clear copy with last-checked timestamp when sources are Current; explicit
incompleteness copy when degraded.

**Disclaimers:** footer + first-run: data from openFDA/FSIS/CDC, unvalidated, not an
official alerting service.

## 13. Phased build plan

Ingest-first, auth-last. Each phase's exit criteria are in §14.

- **Phase 0 — Ingest, enrich, store (no UI).** Source adapters for both recall APIs →
  normalize → enrichment → upsert with content hashes; `sourceHealth` live; seed one
  household via the §11 questionnaire structure.
- **Phase 1 — Read-only dashboard (Core-tier PWA).** Feed + detail + filters + Timeline +
  bookmarks; FDA RSS/press ingest for images + risk-group text with Open Food Facts
  fallback; read-only Household tab; source-health banner.
- **Phase 2 — Notifications: email.** Matching engine with structured output; decision
  matrix implemented; Resend instant + daily digest (incl. empty digest with reassurance
  gate); per-revision dedupe.
- **Phase 3 — Notifications: web push.** Service worker push, VAPID, contextual permission
  flow with alert preview, deep links, lock-screen-safe content. Production-grade audit.
- **Phase 4 — CDC outbreaks.** Scraper/parser → `outbreaks` → unified alerts query;
  state/keyword/risk-group matching; "be aware" framing; anomaly detection wired into
  `sourceHealth`.
- **Phase 5 — Accounts, onboarding, Household UI. The public gate.** Convex Auth; §11
  questionnaire as first-run onboarding + "Redo setup"; household invitations with roles;
  full §2 privacy checklist (verification, unsubscribe, deletion/export, authz tests,
  push redaction verified).
- **Phase 6 — Chain matching & polish.** Fuzzy retailer matching labeled per §11;
  severity styling; empty-state polish; share flows.
- **Phase 7 — Scanner & pantry.** Camera UPC scanning (in-store check + pantry audit), scan
  history, **scan-to-pantry** persistence with automatic matching against future recalls;
  "no known recall" phrasing with same-manufacturer soft check.

## 14. Release acceptance matrix

| Phase | Exit criteria (all must pass) |
|---|---|
| 0 | Parser **fixture tests** per adapter (recorded real API responses, incl. malformed cases). Backfill completes without rate-limit errors. Enrichment spot-check on a 100-record stratified sample: allergen tagging ≥95% recall (missed allergens are the failure that matters), audience classification ≥90% accuracy. Re-running ingest on unchanged data produces zero new revisions (hash stability). `sourceHealth` transitions verified by simulated failure. |
| 1 | Lighthouse: installable, Core PWA checklist passes; custom offline page. Feed renders 500+ records with images or placeholders; Timeline renders multi-update recalls. Read-only Household summary matches seeded prefs. Degraded-source banner appears when a source is forced Delayed. Responsive 320px–1920px; latest 2 versions of Chrome/Safari/Firefox/Edge. |
| 2 | Decision-matrix table implemented as tests: every row has at least one automated case. Replay test: re-running dispatch after a simulated crash sends zero duplicates. Digest contains only unsent items; empty digest renders both reassurance and degraded variants. Hard floor and category-gate precedence covered by tests. |
| 3 | Push received on iOS-installed PWA and Android; deep links open the correct detail view; push payload contains no health-attribute text (manual check). Permission prompt only fires post-explainer. Lighthouse ≥90 across categories. |
| 4 | CDC fixtures incl. a zero-record page → source goes Delayed and operator is alerted, verified by test. Outbreaks appear in unified feed with "be aware" framing; risk-group matching test passes. |
| 5 | Authorization tests: a member of household A cannot read/write household B (query + mutation). Email verify, unsubscribe (one click), account deletion, and data export all functional. Onboarding completable in <3 min; "Redo setup" prefills. WCAG 2.2 AA pass on onboarding + feed + detail. This gate must pass before any non-pilot user is invited. |
| 6 | Chain matches always carry 'possible' labeling in feed, digest, and detail; never instant-notify (test). |
| 7 | Scan of a known-recalled UPC surfaces the recall; unknown UPC renders "no known recall" copy; pantry item auto-matches a subsequently ingested recall (test with fixture). |

## 15. Gotchas

- **Updates ≠ new records:** openFDA mutates old records. Content hash is the single
  source of truth for "material"; the matrix in §9 governs everything downstream.
- **Pagination/rate limits:** openFDA caps 1000 records/call; use an API key; chunk
  backfills via the scheduler within Convex action time limits.
- **Multiple schemas:** FDA, FSIS, CDC, and press HTML all differ. The adapters are the
  project's center of gravity; test them with fixtures, not live calls.
- **Enrichment misclassification:** see the deliberate error-bias rules in §4.
- **Scraper fragility (CDC + press releases):** zero-record anomaly detection + operator
  alert, per §10.
- **Image hotlinking:** press-release image URLs can rot; mirror to Convex file storage
  for matched/bookmarked alerts at minimum.
- **Digest timezones:** `timezone` per member; v1 single-household can hardcode one zone.
- **Alert fatigue is the real failure mode.** Recommended preset, hard floor, and the
  empty digest keep the tool trusted. Resist adding notification knobs.

## 16. Out of scope for v1 (candidates for later)

- **CPSC consumer-product recalls** (toys, cribs, car seats, appliances) — strongest
  expansion: pairs directly with household risk-group matching. Separate API.
- Drug/supplement/cosmetic recalls — same openFDA family, cheap to add after CPSC.
- Vehicle recalls (NHTSA) — poor fit for the feed model (VIN-based one-time lookups); skip.
- SMS, native app builds, multi-household admin, international sources (CFIA/RASFF/FSA).
- Monetization: none for personal use. If public later, prefer a tip-jar model over
  paywalling relevance.

## 17. Settled decisions

1. PWA, not native.
2. No SMS — web push + email only.
3. Instant and digest both supported; single per-member urgency threshold with a Class I +
   allergen/risk-group hard floor. Default preset: Recommended.
4. No per-category thresholds (category on/off + one global threshold).
5. Match logic: OR across dimensions, gated by category toggles.
6. **The category gate is absolute — it overrides the hard floor.** Disabled categories are
   never evaluated.
7. Backend: Convex. Scheduled ingest via Convex crons; auth via Convex Auth in Phase 5.
8. Hosting: Vercel (frontend) + Convex (backend).
9. Auth deferred to Phase 5; **Phases 0–4 are a private pilot** with non-public preference
   access. Phase 5 is the public gate with the §2 privacy checklist.
10. Feed model: one feed, boost-and-badge; never hide alerts.
11. **Preference changes re-rank the feed but never trigger retroactive notifications.**
12. **Resolved/withdrawn recalls never notify instantly**; digest closure lines only for
    previously notified members.
13. **Reassurance copy requires all enabled sources Current**; any degraded source switches
    the app to explicit-incompleteness language.
14. Navigation: Feed / Scanner / Saved / Household; no separate Settings tab; Household is
    read-only until Phase 5.
15. Onboarding: multi-step questionnaire per §11, skippable except location, re-runnable
    via "Redo setup," prefilled.
16. Scope: US-only food + outbreaks through Phase 7; CPSC first expansion candidate.
17. Branding: **Recall Log**, tagline "Recalls that actually apply to you"; household-
    centric positioning; brand tokens per §12.
