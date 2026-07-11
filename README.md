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
| USDA FSIS Recall API | Meat, poultry, egg products | Every 3 hours |
| FDA Recalls RSS / press releases | Images + risk-group text (Phase 1) | Every 3 hours |
| CDC outbreak investigations | Foodborne outbreaks (Phase 4) | Every 3 hours |

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

## Project layout

```
convex/
  schema.ts            Convex schema (SPEC.md §6)
  crons.ts             Scheduled ingest (SPEC.md §4)
  ingest/              Per-source actions: fetch → normalize → enrich → upsert
  adapters/            Pure normalization per source (openFDA, FSIS) — the
                       project's center of gravity; tested with fixtures
  lib/                 Enrichment, state normalization, lifecycle, content hash
  recalls.ts           Upsert with content-hash revisioning + updateHistory
  sourceHealth.ts      Data-health contract (SPEC.md §10)
  seed.ts              Pilot household seed, structured as the §11 questionnaire
tests/
  fixtures/            Recorded API response shapes, incl. malformed cases
  *.test.ts            Adapter, enrichment, hash-stability, sourceHealth tests
```

## Build phases

Ingest-first, auth-last (SPEC.md §13; exit criteria in §14):

- [x] **Phase 0** — Ingest, enrich, store (no UI); source health; household seed
- [ ] **Phase 1** — Read-only PWA dashboard (feed, detail, timeline, bookmarks)
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
