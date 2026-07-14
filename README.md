# Food Recalls

**Recalls that apply to you and your family.**

A household food-safety monitoring tool: it pulls federal recall and outbreak data,
enriches and filters it down to what actually affects *your household* — your state, the
brands and products you buy, your allergens, your members' risk groups, your pets — and
alerts you. PWA dashboard with opt-in email and web push notifications.

The full product and build spec lives in [SPEC.md](./SPEC.md). This README is the
operational quick-start; the spec is authoritative when they disagree.

## Why

Government recall sites make three simple questions hard:

1. Is there a new food recall or active outbreak?
2. Does it affect **my household**?
3. If nothing affects us, can I trust that silence?

Question 3 is a system contract: the app only expresses reassurance ("you're all clear")
when it can prove its data sources are current. See SPEC.md §10.

## Stack

- **Backend / database:** [Convex](https://convex.dev) — schema, queries, mutations,
  actions, cron-scheduled ingest.
- **Frontend (Phase 1+):** Next.js PWA + Tailwind, hosted on Vercel.
- **Email (Phase 2+):** Resend. **Push (Phase 3+):** Web Push + VAPID.

## Data sources

| Source | Covers | Ingest cadence |
|---|---|---|
| openFDA Food Enforcement API | Packaged foods, produce, supplements, pet food | Daily |
| USDA FSIS Recall API | Meat, poultry, egg products | Every 3 hours ⚠️ |
| FDA Recalls RSS / press releases | Images + risk-group text (Phase 1) | Every 3 hours |
| CDC outbreak investigations | Foodborne outbreaks (Phase 4) | Every 3 hours ⚠️ |

> ⚠️ **FSIS is currently blocked upstream** (verified 2026-07-11): fsis.usda.gov
> answers HTTP 403 to every non-browser client — curl, PowerShell, and Convex's
> fetch all fail regardless of headers, while a real browser gets the data. This
> is TLS-fingerprint-level bot detection, so no server-side header change can fix
> it. Until resolved (options: ask FSIS to allowlist, or route via a
> browser-fingerprint proxy), `sourceHealth` correctly reports FSIS as
> degraded and the app refuses all-clear reassurance copy — the §10 contract
> working as designed. Meat/poultry/egg-product recalls are missing from the
> feed in the meantime.

> ⚠️ **CDC is also currently blocked upstream** (verified 2026-07-13, same
> failure mode as FSIS above): cdc.gov answers HTTP 403 to Convex's `fetch`
> even with a full browser-like header set, while the `www.cdc.gov` pages
> render fine in an actual browser — the same TLS-fingerprint-level bot
> detection, not a fixable header. The adapter and ingest pipeline
> (`convex/adapters/cdc.ts`, `convex/ingest/cdc.ts`) are built and fixture-
> tested against real captured CDC markup and verified working end-to-end
> against a manually-seeded record (see Phase 4 below); only the live 3h cron
> fetch is currently blocked. `sourceHealth` correctly reports `cdc` as
> degraded in the meantime — verified live: the feed banner read "Coverage
> incomplete — USDA meat & poultry data & CDC outbreak data haven't updated
> recently."

> **Disclaimer:** Data comes from openFDA, FSIS, and CDC. openFDA states its data is
> unvalidated and not intended as a public alerting source. This project is not an
> official alerting service; always verify against the linked official notice.

## Getting started

```bash
npm install

# Start a Convex dev deployment (creates convex/_generated and .env.local)
npx convex dev

# In the Convex dashboard or CLI, set the openFDA API key (free to register)
npx convex env set OPENFDA_API_KEY <your-key>

# Seed the pilot household (edit convex/seed.ts answers first)
npm run seed

# Kick off the initial backfill (also runs on cron thereafter)
npx convex run ingest/openfda:backfill
npx convex run ingest/fsis:ingest
```

Run tests (no Convex deployment required — uses `convex-test` and recorded fixtures):

```bash
npm test
npm run typecheck
```

### Frontend

```bash
npm run dev:web    # Next.js dev server (run `npm run dev` for Convex in another terminal)
```

### Accounts / auth (Phase 5)

Sign-in is passwordless email OTP via Convex Auth (SPEC.md §2/§5). Set the JWT
signing keys on the Convex deployment once (the `npx @convex-dev/auth` wizard
generates them, or generate an RS256 keypair by hand):

```bash
npx convex env set JWT_PRIVATE_KEY <PKCS8 private key>   # newlines as spaces
npx convex env set JWKS <public JWKS JSON>
npx convex env set SITE_URL http://localhost:3000        # your frontend origin
```

Sign-in codes and household invites email through the same Resend config as
notifications; without `RESEND_API_KEY` set, codes are logged to the Convex
deployment (dev only) so local sign-in still works. On first sign-in a user is
bound by verified email to any pre-existing member row (the pilot owner claims
the seeded household), otherwise they're sent through onboarding. The old
`PILOT_ACCESS_SECRET` gate is retired — every function now enforces
per-household authorization.

`npx convex dev` writes `NEXT_PUBLIC_CONVEX_URL` into `.env.local` automatically on first run.
See `.env.example` for the full list.

## Project layout

```
convex/
  schema.ts            Convex schema (SPEC.md §6)
  crons.ts             Scheduled ingest (SPEC.md §4)
  ingest/              Per-source actions: fetch → normalize → enrich → upsert
  adapters/            Pure normalization per source (openFDA, FSIS, CDC) — the
                       project's center of gravity; tested with fixtures
  lib/                 Enrichment, state normalization, lifecycle, content hash,
                       auth.ts (per-household authorization, Phase 5), matching,
                       digest, email, push payloads, pantry matching
  recalls.ts           Upsert (internal) + public list/get (Phase 1 feed);
                       schedules notification dispatch on new/updated recalls
  outbreaks.ts         CDC outbreak upsert (internal) + public list/get (Phase 4);
                       notification dispatch intentionally not yet wired, see below
  press.ts             FDA press-release enrichment: photo/risk-group/notice-URL
                       patches onto matching recalls; relink for late API records
  notifications.ts     Dispatch (§9): matcher × decision matrix, per-revision
                       dedupe, instant email + daily digest, operator alerts
  sourceHealth.ts      Data-health contract (SPEC.md §10) + public status query
  household.ts         Auth-gated household summary/edit/export/delete (SPEC.md §2, Phase 5)
  bookmarks.ts         Public bookmark list/toggle; resolves both recall and outbreak alertTypes
  feed.ts              §8 "For your household" matching (Phase 6): reactive
                       per-household queries feeding reason chips + the pinned section
  pantry.ts            Scanner/pantry (Phase 7): UPC scan, same-manufacturer
                       soft match, live auto-matching against active recalls
  seed.ts              Pilot household seed, structured as the §11 questionnaire
app/                    Next.js App Router — Feed / Scanner / Saved / Household /
                       Detail / Outbreak detail, PWA manifest + generated icons,
                       Serwist service worker
components/             Shared UI (RecallCard, OutbreakCard, Timeline, FilterBar, etc.)
lib/                    Frontend-only copy/format helpers (not imported from convex/)
tests/
  fixtures/            Recorded API response shapes, incl. malformed cases
  *.test.ts            Adapter, enrichment, hash-stability, sourceHealth,
                       recalls/bookmarks/household public-API tests
```

## Build phases

Ingest-first, auth-last (SPEC.md §13; exit criteria in §14). All 8 phases have
shipped; the open items mentioned inside the entries below (WCAG audit, outbreak
dispatch, device push verification, etc.) are tracked in [TODO.md](./TODO.md),
which is the single working backlog now:

- [x] **Phase 0** — Ingest, enrich, store (no UI); source health; household seed.
      Exit criteria closed 2026-07-11: full openFDA backfill complete (29,215
      records, count-parity with the API's advertised total, zero failures) and
      the §14 enrichment spot-check passed on a 120-record stratified sample —
      allergen recall 96.8% (≥95% required), audience accuracy 100% (≥90%).
      Method and findings in [docs/enrichment-spot-check.md](./docs/enrichment-spot-check.md).
      Hash stability hardened 2026-07-12: a content-hash change with an
      identical raw source record (i.e. our enrichment/hash code changed, not
      the source) now refreshes tags silently — no fabricated revision, no
      timeline noise, no notification dispatch — so enrichment improvements
      plus a backfill re-run can never trigger an alert storm.
- [x] **Phase 1** — Read-only PWA dashboard (feed, detail, timeline, bookmarks).
      UI shipped and verified: Core-tier PWA scaffold, public Convex API
      layer, all four screens tested against live data, Lighthouse
      100/100/100 (performance/accessibility/best practices) on Feed and
      Household, responsive 320px–1920px with no overflow, 44px touch
      targets, WCAG AA color contrast. Audit fixes landed 2026-07-11:
      read-time source-health staleness (the §10 gate now fails closed on a
      dead scheduler), footer + first-run disclaimers, all-clear empty state
      carries the last-checked timestamp, Household tab renders dynamically.
      FDA RSS/press ingest landed 2026-07-12 (`convex/ingest/fdaRss.ts` +
      `convex/press.ts`): every 3h, new press pages are fetched and their
      product photo, "who's at risk" risk groups, and real notice URL enrich
      the matching enforcement records (matched by company name + date
      window; unmatched items relink on later runs since enforcement records
      lag press releases by weeks). Open Food Facts by-UPC image fallback
      included; cards/detail render the resolved image object-contain in the
      hazard-tinted container, placeholder otherwise. Verified end to end
      against the live feed. Still open: FSIS upstream 403 (see Data sources
      above); cross-browser testing beyond Chromium; the Detail page's
      per-recall SEO metadata doesn't reach `<head>` at parse time due to a
      Next.js 15 streaming-metadata quirk on client-rendered dynamic routes
      (low-stakes — this is an unlisted private pilot, §2).
- [x] **Phase 2** — Email notifications (matching engine, instant + daily digest).
      Backend shipped: the §7 matcher + §9 decision matrix as pure functions
      (`convex/lib/matching.ts`), stateful dispatch with per-revision dedupe and
      an eager digest queue (`convex/notifications.ts`), Resend transport
      (`convex/lib/email.ts`, no-ops without `RESEND_API_KEY`), the daily digest
      with the §10 reassurance gate (`convex/lib/digest.ts`, sends even when
      empty), and operator self-alert email on source-health degradation. Every
      §9 matrix row, the hard-floor/category-gate precedence, replay
      idempotency, and both empty-digest variants are covered by tests. Set
      `RESEND_API_KEY`/`RESEND_FROM`/`OPERATOR_EMAIL`/`APP_BASE_URL` in the
      Convex env (see `.env.example`) to enable live sending. Fixed 2026-07-12:
      a material update to an already-closed recall (closed→closed source
      edit) is now timeline-only — it never dispatches instant or digest
      notifications, per SPEC.md §17.12 and the §10 archive exclusion.
      Deferred: the feed's "For your household" personalized section/reason
      chips (UI wiring of the same matcher) and web push (Phase 3).
- [x] **Phase 3** — Web push notifications. Shipped: VAPID Web Push end to
      end — service worker `push`/`notificationclick` handlers (`app/sw.ts`)
      with lock-screen-safe payloads (`convex/lib/push.ts`: product name +
      severity + deep link only, no match reasons — enforced by the
      function's signature, which has no way to accept `matchedOn`), a Node
      delivery action that no-ops without VAPID keys and self-clears a
      subscription on a 404/410 (`convex/push.ts`), and push wired into the
      §9 dispatch matrix as a second, fully independent instant channel
      (`convex/notifications.ts`) — push never queues and never sends
      closure/resolution lines, since the email digest remains the sole
      "quiet" channel. Contextual permission flow
      (`components/PushNotificationSetup.tsx`): a preset-aware explainer +
      alert preview (push preview for Recommended/Everything, an email
      preview for Digest only) renders before the native prompt ever fires.
      (Originally shipped behind pilot-secret-gated Route Handlers; superseded
      in Phase 5 — subscribe/unsubscribe are now authenticated Convex
      mutations in `convex/pushSubscriptions.ts`, and the Route Handlers and
      pilot secret are gone.) Per-channel dedupe/routing (independent
      `notificationsSent` rows, instant-only, never on closures) covered by
      tests. Set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
      (Convex env) and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (`.env.local`) to
      enable live sending — see `.env.example`. Not yet verified: real push
      receipt on an iOS-installed PWA and on Android (§14 requires physical
      devices) and a fresh Lighthouse ≥90 pass across all categories.
- [x] **Phase 4** — CDC outbreaks. Shipped: a regex-based scraper adapter
      (`convex/adapters/cdc.ts`) for CDC's "Current Outbreak List" landing
      page plus each investigation's own detail page — no clean structured
      API exists (§3), so this follows the same fixture-tested-not-live-called
      approach as the FDA RSS adapter. A pathogen-keyword filter keeps only
      foodborne/zoonotic-enteric investigations (E. coli, Salmonella,
      Listeria, botulism, etc.) out of a landing page that also lists
      Measles, COVID-19, and other unrelated CDC outbreaks. Every qualifying
      investigation's detail page is re-fetched each 3h cron run (rather than
      cached like press releases) since that's what surfaces an Open→Closed
      transition or an updated case count — CDC's list only ever holds a
      handful of current investigations, so the cost is small
      (`convex/ingest/cdc.ts`). Content-hash revisioning and the zero-record
      anomaly → `sourceHealth` (source `cdc`, already modeled since Phase 0)
      mirror the recall adapters exactly (`convex/outbreaks.ts`). The §7
      matcher already generalized to outbreak-shaped alerts (state, keyword
      via `suspectedFood`, risk-group) with no production code changes needed
      — only tests (`matching.test.ts`). Outbreaks appear in the Feed
      interleaved with recalls by date (`OutbreakCard`, orange "Be aware"
      badge per §12's severity system, red impact line for case/hospitalization
      counts), with a full detail view (`OutbreakDetail`, Timeline, bookmark +
      share) at `/outbreaks/[id]`. Bookmarks and the Saved tab now handle both
      alert types.
      **Deliberately deferred** (tracked here rather than silently dropped,
      same as prior phases' open items): (1) **outbreak notification
      dispatch** — `notificationsSent`/`digestQueue` already model an
      `outbreak` alertType and §4 specifies "active outbreaks treated as
      Class I equivalent for alerting," but wiring instant/digest delivery
      through `convex/notifications.ts` is left for a focused follow-up
      rather than bundled into this phase; (2) **per-state case counts** —
      CDC's own state-by-state breakdown is rendered by a client-side chart
      widget fed from a per-outbreak JSON file whose path isn't derivable
      from the investigation's URL, so `states` is a best-effort extraction
      from distribution/summary prose on the detail page itself (via the
      same `parseStatesFromText` FSIS uses as a fallback) — consistent with
      §7's acknowledged "matching degrades to state + keyword" for
      outbreaks, but not CDC's authoritative case-location list; (3) the §8
      "For your household" feed-personalization section and reason chips
      remain unbuilt for both recalls and outbreaks (matcher output exists,
      UI wiring doesn't).
- [x] **Phase 5** — Accounts, onboarding, household UI — the public gate.
      Shipped: **Convex Auth** with passwordless **email OTP** (`convex/auth.ts`,
      `convex/ResendOTP.ts`, `convex/http.ts`) reusing the notifications Resend
      transport; **per-household authorization** replaces the pilot secret —
      every sensitive function resolves the caller's own member row and only
      touches that member's household (`convex/lib/auth.ts`), so cross-household
      access isn't expressible. First sign-in **claims** any pre-existing member
      by verified email (`convex/lib/members.ts`), so the seeded pilot household
      transitions with no manual migration. **Onboarding** is the §11
      questionnaire as a 5-step wizard (`components/OnboardingWizard.tsx`),
      reused prefilled for **"Redo setup"**; the Household tab is now fully
      editable (categories, brands/keywords, notification preset, email toggle,
      push). **Invitations with roles** (`convex/invites.ts`): the owner emails
      a tokenized invite, the invitee signs in with that verified address and
      is bound to the household. Full §2 privacy checklist: **email
      verification** (inherent to OTP), **one-click unsubscribe**
      (`convex/unsubscribe.ts` + `/unsubscribe`, token in every email footer),
      **account deletion** (tears down the household when the last member
      leaves) and **data export** (`household.exportData`), **authorization
      tests** (§14: A-can't-read/write-B, owner-only guards, isolation —
      `tests/household.test.ts`, `tests/invites.test.ts`), and **push
      redaction** (already enforced by `convex/lib/push.ts`'s signature since
      Phase 3). Verified end to end against the dev deployment: OTP sign-in →
      claim-by-email into the Hiatt household → editable Household tab →
      unsubscribe link resolves. 221 tests green. Auth env vars in the Accounts
      section above. Still open: a formal WCAG 2.2 AA audit of the onboarding/
      feed/detail screens, and the §8 "For your household" feed personalization
      (carried forward, matcher output exists).
- [x] **Phase 6** — Chain matching & polish. Shipped: **chain (fuzzy retailer)
      matching** — `matchRecall` (`convex/lib/matching.ts`) now matches a
      household's saved stores against a recall's raw `distribution` text,
      always at `'possible'` confidence (§7: chain-only matches never notify
      instantly; `decideRoute` already enforced this, now it's reachable).
      The matcher also gained `matchedDetails`, naming exactly *which*
      allergen/risk-group/store/brand/keyword matched, not just the
      dimension — powers real reason chips ("Allergen: milk," "Publix,"
      "Infant risk") instead of generic labels. Built alongside it, since
      Phase 6's own exit criteria (chain matches labeled in "feed... and
      detail") is unreachable without it: the **§8 feed personalization UI**,
      deferred since Phase 2 (matcher output existed, no UI wiring — see
      Phase 2/4/5 entries above). New `convex/feed.ts` (`myMatches`,
      `matchForAlert`) reactively scopes matching to the caller's own
      household (bounded scans, never a full-table `.collect()` — same
      16MB-budget concern as `press.relinkUnmatched`), ranked per §8
      (risk-group/allergen matches first, then severity, then confidence,
      then recency). Frontend: `HouseholdMatchSection` ("For your household"
      pinned section, hidden entirely when there are no matches rather than
      showing an empty box), `ReasonChips` (chain matches render with a
      dashed outline instead of a filled pill — visually distinct without
      extra card text; full "possible match... verify" copy lives on
      Detail, §11), a "Matched us" filter chip, a live Feed nav badge (count
      of active household-matched alerts, clearing on resolve/archive per
      §12 — not an unread count), and an editable "Stores you shop at" list
      on the Household tab (previously read-only). 235 tests green
      (`matching.test.ts` chain cases, new `feed.test.ts`). Deliberately
      unchanged: severity styling and share flows were already fully built
      (Phase 4's severity system; `ShareButton` on both Detail views since
      Phase 1) — audited, not rebuilt.
- [x] **Phase 7** — Barcode scanner & pantry. Shipped: a **Scanner** tab
      (`app/scanner/page.tsx`, now the 4th `BottomNav` entry) with camera
      barcode scanning (`components/BarcodeScanner.tsx`, ZXing's
      `BrowserMultiFormatReader` dynamically imported on that route only —
      chosen over the native `BarcodeDetector` API because that's
      Chrome/Android-only and this app targets iOS-installed PWAs too, per
      Phase 3) plus manual UPC entry that's always available, feature-detected
      the same way `ShareButton` degrades. `convex/pantry.ts` implements the
      §3 fallback chain: an exact-UPC check against active recalls'
      `productCodes` first (no external call needed); only on a miss does it
      look up the product's brand via Open Food Facts (same source as the
      Phase 1 image fallback) and try a same-manufacturer soft match
      ("possible" confidence). Every scan persists to `pantryItems` — one
      table doubling as scan history and current pantry contents, per the
      schema's design — and `pantry.matches` is a **live reactive query**,
      so a pantry item auto-matches the moment a matching recall is
      ingested, with zero extra wiring (verified by fixture test, §14). Copy
      follows §11 exactly: "No known recall" (never "safe") on a miss, a
      "possible match" framing on the soft match. Account deletion/export
      (§2) extended to cover pantry data. `convex/lib/pantry.ts` (pure
      matching) + `convex/pantry.ts` covered by 14 new tests; 249 tests
      green overall.

**Phases 0–4 were a private pilot** (no public signup; preference-reading functions
were secret-gated). **Phase 5 is the public gate**: Convex Auth + per-household
authorization on every function. See SPEC.md §2.

## License

[MIT](./LICENSE)
