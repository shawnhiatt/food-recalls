# Food Recalls — TODO

Working backlog now that all 8 phases in SPEC.md §13 are shipped. Nothing here blocks
the app being usable; this is what's left for a hardening/polish pass. Grouped by
urgency, not spec order.

## Production setup (quick, do these first)

- [x] **Set `RESEND_API_KEY` + `RESEND_FROM` on the production Convex deployment**
      (`good-lynx-479`) for real email delivery — sign-in OTP codes, invites,
      instant/digest notifications. Right now they only land in the Convex
      dashboard's Logs tab.
      `npx convex env set RESEND_API_KEY <key> --prod`
      `npx convex env set RESEND_FROM "Food Recalls <alerts@yourdomain>" --prod`
- [x] **Set `OPENFDA_API_KEY`** on both dev and prod — currently running
      unauthenticated (lower rate limit). Free to register.
      `npx convex env set OPENFDA_API_KEY <key> --prod` (and without `--prod` for dev)
- [x] **Set `OPERATOR_EMAIL` on prod** so source-health degradation (FSIS/CDC, see
      below) actually self-alerts instead of only logging.
- [x] **Sign in on the production URL** and confirm claim-by-email binds you to the
      seeded "Hiatt household" — first real end-to-end check of prod auth.
- [x] **Decide what to do with the dev deployment's crons.** Resolved 2026-07-14:
      env-gated all cron registrations behind `ENABLE_CRONS` in `convex/crons.ts`.
      Set only on prod (`good-lynx-479`), so dev no longer registers or runs any
      crons. Note: Convex evaluates cron env vars at deploy time only — the flag
      must be set on a deployment *before* code lands there or its crons drop.
      Dev redeployed clean; prod keeps its crons on its next deploy (flag armed).
- [x] Confirm the openFDA historical backfill on prod finished (~29k records last
      time; it self-schedules via `ctx.scheduler`, no need to babysit it, just
      check the count later: `npx convex data recalls --prod`). Verified 2026-07-14:
      `fda`/`fda_rss` sources report `current` with recent successful runs and
      recall data is populated.

## Data-source reliability

- [ ] **FSIS and CDC are permanently blocked upstream** (HTTP 403, TLS-fingerprint
      bot detection — verified on both dev and prod). Two real options: (a) a
      browser-fingerprint-capable proxy in front of the fetch, or (b) ask each
      agency to allowlist this app's requests. Until then, `sourceHealth`
      correctly reports both as degraded and the app permanently shows "coverage
      incomplete" rather than false reassurance — working as designed, but worth
      actually fixing rather than living with forever.

## Carried-forward from the spec audits (never closed)

- [ ] **Formal WCAG 2.2 AA audit** of onboarding, feed, and detail screens (§14
      Phase 5 exit criterion — shipped without a dedicated pass).
- [x] **Outbreak notification dispatch.** Shipped 2026-07-18. `dispatchForOutbreak`
      (`convex/notifications.ts`) mirrors `dispatchForRecall`: active outbreaks are
      Class I-equivalent (§4), gated upstream by the household `outbreaks` toggle,
      delivered instant (email + push) with an active→resolved transition producing
      a digest closure line. Additive render paths keep the §11 "be aware" voice
      (`lib/digest.ts`, `lib/email.ts`, `lib/push.ts`) without touching recall copy;
      `outbreaks.upsertBatch` schedules new/material/resolution. +11 tests
      (`outbreak-notifications.test.ts`, digest/matching additions), 274 green.
      Plan doc: [docs/outbreak-notification-dispatch.md](docs/outbreak-notification-dispatch.md).
- [ ] **Real-device push verification** (iOS-installed PWA + Android) and a fresh
      Lighthouse ≥90 pass across all categories (§14 Phase 3 exit criteria,
      never actually run on physical hardware).
- [ ] Cross-browser testing beyond Chromium (§14 Phase 1 exit criterion).

## Spec gaps found in the 2026-07-14 full-codebase review

Everything else claimed shipped was verified in place (249 tests green, typecheck
clean, §10 archive rule, per-member digest timezones, §3 cron cadences, feed nav
badge semantics, §11 label derive-then-pin, no unbranded dark-mode block). These
three requirements were never built:

- [x] **Press-image mirroring to Convex file storage** (§15). Shipped 2026-07-18
      (`convex/images.ts`): a `mirrorRecallImage`/`mirrorOutbreakImage` action
      fetches the image and stores it in Convex file storage, rewriting `imageUrl`
      to the durable storage URL and setting `imageStorageId` (the mirrored marker)
      while keeping `imageSource` provenance. Triggered on first bookmark
      (`bookmarks.toggle`) and on notification match (`dispatchFor*`), both
      idempotent + race-safe. `backfillBookmarkedImages` covers already-bookmarked
      alerts. Verified live on dev: a real fda.gov press image now serves from
      `…/api/storage/…`. +4 tests.
- [x] **Archived alerts are unreachable** (§10). Fixed 2026-07-14 in two parts
      on a shared full-text search index (`searchText` + Convex `searchIndex` on
      recalls/outbreaks, `convex/lib/search.ts`, backfilled over ~29k rows via
      `convex/migrations.ts`):
      - Scanner archived rung (commit 7e99764): an exact UPC on a resolved recall
        now reports `archived_recall` ("had a recall, since resolved" — distinct,
        non-alarming copy) instead of "no known recall" (`convex/pantry.ts`
        `matchArchived`, `app/scanner/page.tsx`).
      - Search (commit 420a6b7): `/search` route + `recalls.search`/
        `outbreaks.search`, spanning archived alerts the feed hides. Verified
        live on dev.
      Fully live on **prod** as of 2026-07-18: Convex deployed, backfill run,
      UPC + word search both verified against `good-lynx-479`.
- [x] **`linkPending` is a dead schema field.** Resolved 2026-07-18: removed the
      field from `convex/schema.ts` and documented the deliberate deviation in
      SPEC.md §4 (press items enrich existing enforcement records with a 180-day
      retry; no provisional records). Chose remove-and-document over implementing
      provisional records — the timeliness win wasn't worth the provisional/real
      dedup complexity for an unlisted personal tool.

## Minor polish (low priority)

- [ ] Digest crash between queue-drain and delivery loses that day's digest for
      affected members (documented at-most-once bias — correct tradeoff, but a
      retry/backfill path would close the gap).
- [x] `digestQueue` enqueues rows even when a member's `digestEnabled` is false
      (wasted writes, not a correctness bug — they're just never read).
      Fixed 2026-07-18: the digest route now guards on `settings.digestEnabled`
      in `convex/notifications.ts` (both recall + outbreak paths).
- [x] `PushNotificationSetup`'s email-preview subject line says "matches" where
      the real digest subject says "affects" — cosmetic mismatch. Fixed 2026-07-18.
- [ ] Detail pages' per-recall SEO metadata doesn't reach `<head>` at parse time
      (Next.js 15 streaming-metadata quirk on client-rendered dynamic routes) —
      low-stakes for an unlisted personal tool, matters more if this goes public.
