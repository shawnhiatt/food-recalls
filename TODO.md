# Food Recalls — TODO

Working backlog now that all 8 phases in SPEC.md §13 are shipped. Nothing here blocks
the app being usable; this is what's left for a hardening/polish pass. Grouped by
urgency, not spec order.

## Production setup (quick, do these first)

- [ ] **Set `RESEND_API_KEY` + `RESEND_FROM` on the production Convex deployment**
      (`good-lynx-479`) for real email delivery — sign-in OTP codes, invites,
      instant/digest notifications. Right now they only land in the Convex
      dashboard's Logs tab.
      `npx convex env set RESEND_API_KEY <key> --prod`
      `npx convex env set RESEND_FROM "Food Recalls <alerts@yourdomain>" --prod`
- [ ] **Set `OPENFDA_API_KEY`** on both dev and prod — currently running
      unauthenticated (lower rate limit). Free to register.
      `npx convex env set OPENFDA_API_KEY <key> --prod` (and without `--prod` for dev)
- [ ] **Set `OPERATOR_EMAIL` on prod** so source-health degradation (FSIS/CDC, see
      below) actually self-alerts instead of only logging.
- [ ] **Sign in on the production URL** and confirm claim-by-email binds you to the
      seeded "Hiatt household" — first real end-to-end check of prod auth.
- [ ] **Decide what to do with the dev deployment's crons.** Both dev and prod now
      poll openFDA/FSIS/CDC/FDA-RSS independently on their own schedules — that's
      double real-world API traffic against the same external sources for no
      benefit once prod is the deployment you actually use. Either keep dev around
      deliberately for a testing sandbox, or stop relying on it day to day.
- [ ] Confirm the openFDA historical backfill on prod finished (~29k records last
      time; it self-schedules via `ctx.scheduler`, no need to babysit it, just
      check the count later: `npx convex data recalls --prod`).

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
- [ ] **Outbreak notification dispatch.** `notificationsSent`/`digestQueue` already
      model an `outbreak` alertType and §4 says active outbreaks are "Class I
      equivalent for alerting," but instant/digest delivery was never wired
      through `convex/notifications.ts` for outbreaks — recalls only.
- [ ] **Real-device push verification** (iOS-installed PWA + Android) and a fresh
      Lighthouse ≥90 pass across all categories (§14 Phase 3 exit criteria,
      never actually run on physical hardware).
- [ ] Cross-browser testing beyond Chromium (§14 Phase 1 exit criterion).

## Spec gaps found in the 2026-07-14 full-codebase review

Everything else claimed shipped was verified in place (249 tests green, typecheck
clean, §10 archive rule, per-member digest timezones, §3 cron cadences, feed nav
badge semantics, §11 label derive-then-pin, no unbranded dark-mode block). These
three requirements were never built:

- [ ] **Press-image mirroring to Convex file storage** (§15). Press-release image
      URLs rot; the spec says to mirror images for matched/bookmarked alerts at
      minimum. `ctx.storage` is unused anywhere in the codebase — cards and
      detail views hotlink `imageUrl` directly. Sketch: an action that fetches
      the image on first bookmark/match, stores it, and swaps `imageUrl` for the
      storage URL (keep `imageSource` provenance).
- [ ] **Archived alerts are unreachable** (§10). The spec keeps archived alerts
      (non-active + older than 12 months) out of the default feed and matching
      but says they stay "reachable via search and pantry/scanner UPC checks."
      Neither path exists: there is no search feature (UI or API), and the
      scanner/pantry only queries `lifecycle === "active"` recalls
      (`activeRecalls` in `convex/pantry.ts`), so scanning a UPC from a
      completed recall reports "no known recall." Fix is two parts: a text
      search over recalls/outbreaks, and an archived-recall rung in the scanner
      result ("this product had a recall, resolved in 2025" — distinct copy,
      not an active warning).
- [ ] **`linkPending` is a dead schema field.** §4 says a press record with no
      matching API record creates a provisional recall flagged `linkPending`;
      the implementation deliberately never creates provisional records — press
      items only enrich existing enforcement records, retrying unmatched items
      for 180 days before lapsing (`convex/press.ts`). That means a recall
      announced by press release surfaces only weeks later when the enforcement
      record lands. Either implement provisional records (spec behavior — better
      timeliness) or remove the field and record the deviation in SPEC.md.

## Minor polish (low priority)

- [ ] Digest crash between queue-drain and delivery loses that day's digest for
      affected members (documented at-most-once bias — correct tradeoff, but a
      retry/backfill path would close the gap).
- [ ] `digestQueue` enqueues rows even when a member's `digestEnabled` is false
      (wasted writes, not a correctness bug — they're just never read).
- [ ] `PushNotificationSetup`'s email-preview subject line says "matches" where
      the real digest subject says "affects" — cosmetic mismatch.
- [ ] Detail pages' per-recall SEO metadata doesn't reach `<head>` at parse time
      (Next.js 15 streaming-metadata quirk on client-rendered dynamic routes) —
      low-stakes for an unlisted personal tool, matters more if this goes public.
