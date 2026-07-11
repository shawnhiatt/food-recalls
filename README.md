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
| CDC outbreak investigations | Foodborne outbreaks (Phase 4) | Every 3 hours |

> ⚠️ **FSIS is currently blocked upstream** (verified 2026-07-11): fsis.usda.gov
> answers HTTP 403 to every non-browser client — curl, PowerShell, and Convex's
> fetch all fail regardless of headers, while a real browser gets the data. This
> is TLS-fingerprint-level bot detection, so no server-side header change can fix
> it. Until resolved (options: ask FSIS to allowlist, or route via a
> browser-fingerprint proxy), `sourceHealth` correctly reports FSIS as
> degraded and the app refuses all-clear reassurance copy — the §10 contract
> working as designed. Meat/poultry/egg-product recalls are missing from the
> feed in the meantime.

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

### Frontend (Phase 1)

```bash
# Set the pilot access secret (gates the read-only Household tab — SPEC.md §2)
npx convex env set PILOT_ACCESS_SECRET <a long random value>
# Mirror the same value into .env.local (server-only; never NEXT_PUBLIC_):
#   PILOT_ACCESS_SECRET=<the same value>

npm run dev:web    # Next.js dev server (run `npm run dev` for Convex in another terminal)
```

`npx convex dev` writes `NEXT_PUBLIC_CONVEX_URL` into `.env.local` automatically on first run.
See `.env.example` for the full list.

## Project layout

```
convex/
  schema.ts            Convex schema (SPEC.md §6)
  crons.ts             Scheduled ingest (SPEC.md §4)
  ingest/              Per-source actions: fetch → normalize → enrich → upsert
  adapters/            Pure normalization per source (openFDA, FSIS) — the
                       project's center of gravity; tested with fixtures
  lib/                 Enrichment, state normalization, lifecycle, content hash,
                       access.ts (pilot secret gate for household.ts)
  recalls.ts           Upsert (internal) + public list/get (Phase 1 feed)
  sourceHealth.ts      Data-health contract (SPEC.md §10) + public status query
  household.ts         Secret-gated read-only household summary (SPEC.md §2)
  bookmarks.ts         Public bookmark list/toggle (single-household pilot)
  seed.ts              Pilot household seed, structured as the §11 questionnaire
app/                    Next.js App Router — Feed / Detail / Saved / Household,
                       PWA manifest + generated icons, Serwist service worker
components/             Shared UI (RecallCard, Timeline, FilterBar, etc.)
lib/                    Frontend-only copy/format helpers (not imported from convex/)
tests/
  fixtures/            Recorded API response shapes, incl. malformed cases
  *.test.ts            Adapter, enrichment, hash-stability, sourceHealth,
                       recalls/bookmarks/household public-API tests
```

## Build phases

Ingest-first, auth-last (SPEC.md §13; exit criteria in §14):

- [x] **Phase 0** — Ingest, enrich, store (no UI); source health; household seed.
      Exit criteria closed 2026-07-11: full openFDA backfill complete (29,215
      records, count-parity with the API's advertised total, zero failures) and
      the §14 enrichment spot-check passed on a 120-record stratified sample —
      allergen recall 96.8% (≥95% required), audience accuracy 100% (≥90%).
      Method and findings in [docs/enrichment-spot-check.md](./docs/enrichment-spot-check.md).
- [ ] **Phase 1** — Read-only PWA dashboard (feed, detail, timeline, bookmarks).
      UI shipped and verified: Core-tier PWA scaffold, public Convex API
      layer, all four screens tested against live data, Lighthouse
      100/100/100 (performance/accessibility/best practices) on Feed and
      Household, responsive 320px–1920px with no overflow, 44px touch
      targets, WCAG AA color contrast. Audit fixes landed 2026-07-11:
      read-time source-health staleness (the §10 gate now fails closed on a
      dead scheduler), footer + first-run disclaimers, all-clear empty state
      carries the last-checked timestamp, Household tab renders dynamically.
      Still open: FDA RSS/press ingest for images + risk-group text and the
      Open Food Facts fallback (cards show the hazard-tinted placeholder
      illustration for every recall until that lands; this also replaces the
      openFDA detail link, which currently points at the raw API record);
      FSIS upstream 403 (see Data sources above); cross-browser testing
      beyond Chromium; the Detail page's per-recall SEO metadata doesn't
      reach `<head>` at parse time due to a Next.js 15 streaming-metadata
      quirk on client-rendered dynamic routes (low-stakes — this is an
      unlisted private pilot, §2).
- [ ] **Phase 2** — Email notifications (matching engine, instant + daily digest)
- [ ] **Phase 3** — Web push notifications
- [ ] **Phase 4** — CDC outbreaks
- [ ] **Phase 5** — Accounts, onboarding, household UI — the public gate
- [ ] **Phase 6** — Chain matching & polish
- [ ] **Phase 7** — Barcode scanner & pantry

**Phases 0–4 are a private pilot.** No public signup, and all preference-reading Convex
functions are internal (non-public) because household preferences contain sensitive
information. See SPEC.md §2.

## License

[MIT](./LICENSE)
