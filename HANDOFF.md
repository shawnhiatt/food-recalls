# HANDOFF — Food Recalls

Where the last session stopped. Newest entry first.

## 2026-11-12: Press fixes reconciled on prod (Food Recalls (main))

T6's generic-firm matcher fix (`b9810f6`) and the FDA relay (T2/T5) were each deployed to prod from their own worktrees, and the relay's deploy dropped T6's fix. Both are now merged to main (`e278b05`, pushed), and prod Convex is redeployed from main. `press:unlinkFalseMatches` dropped the 2 false M.G. Foods links the backfill had re-created; a follow-up dry run finds 0. `fda_rss` is current via the Mac launchd relay (`docs/fda-relay.md`). New rule in CLAUDE.md: deploy prod Convex only from pushed main. Open: the 21 Taylor Farms → Taylor Farms de Mexico false links (in TODO.md), the wrong "infant" risk group on the Oliva recalls (`convex/lib/enrichment.ts:99`, "Baby Ghanouj"), and the remaining health-audit tickets T3, T4, T7, T10, T11. iOS: the spec is written in `~/Documents/projects/food-recalls-ios` (uncommitted, no remote).

## 2026-11-12: FDA press relay (T2 + T5)

`fda_rss` is **current on prod again** (it had been unavailable since 2026-10-24, with 150 failures). fda.gov denies Convex's egress, so a launchd agent on Shawn's Mac (`app.foodrecalls.fda-relay`, every 3h) fetches the feed and new press pages and POSTs them to the new Convex HTTP action `/relay/fda-rss` (shared secret `FDA_RELAY_SECRET`, set on prod Convex and in the Mac's login Keychain). Convex's own fetch still runs. `sourceHealth` now tracks per-transport success, and a failure on one transport isn't counted while the other is current. See `docs/fda-relay.md` for install, uninstall and rotation.

- T2: the Vercel probe was deployed as a Preview, but its result wasn't read (Vercel SSO), and Hobby crons are daily only. The probe branch was deleted. If Vercel matters later, re-probe, then have a route call `runRelay` with a Convex cron driving it.
- Backfill: 11 press items from 2026-10-24 through 11-10 recorded (press items 139 → 150, newest 10-22 → 11-10). 23 recall links, but **22 are false positives** from the existing matching heuristic (21 Taylor Farms de Mexico lettuce recalls, plus M.G. Foods' burrito). See TODO "Press↔recall matching false positives". Most new items will match only when openFDA publishes their records (prod's newest recallDate is 2026-10-09).
- Dev `intent-donkey-676` runs this branch and has its own random `FDA_RELAY_SECRET`.

## 2026-11-12: iOS redesign in Figma (iOS redesign session)

New Figma file: https://www.figma.com/design/wh0GKJHOwveL6RmZp8nL2v ("Food Recalls iOS", SH team drafts). This is an iPhone-first native redesign driven by the UX audit, in light and dark. Pages: Cover, Foundations (Light/Dark color variables over hidden primitives, a quarantined severity set with computed contrast, SF Pro / Dynamic Type styles at default and AX3, spacing, radius, SF Symbols, and 11 SPEC §12 divergences), Components (~30 sets: recall and outbreak cards in two match tiers, household status card in 3 states, sources, scanner verdicts, plus stand-ins for the iOS chrome), Screens (53 frames: sign-in, onboarding, Feed states, sheets, detail, Kitchen/scanner, Saved, Household, Search, system states), Native extras (widgets, Lock Screen, APNs previews with redaction rules, share sheet, Control Center), and Decisions (20 decisions tied to UX-NN, 9 open questions, the backend changes the design needs). Gotchas: the Figma MCP renderer can't measure SF Pro, so type is drawn in Inter through named styles. The SF Symbols are real outlines exported with CoreText. The Apple iOS 26 kit refuses import until its EULA is accepted. Next: Shawn answers the open questions, then the iOS spec (`SPEC-IOS.md`).

## 2026-11-11: Figma baseline of the PWA (Figma baseline session)

New Figma file: https://www.figma.com/design/XyJxXlBeqLsJFmPeoC68Qm ("Food Recalls — PWA baseline (2026-11)", SH team drafts). It has three pages: Foundations (34 variables plus 17 Public Sans text styles), Baseline (60 editable frames from the running app on dev `intent-donkey-676`, plus 4 read-only prod frames), and Annotations (34 observations for the UX audit). The test accounts are in `.env.example`. Dev now holds a "Baseline test household" with bookmarks, pantry scans and a pending invite. Prod was only viewed. Next: the UX and visual audit.

## 2026-11-11: Orientation after 4 months idle (Food Recalls (main))

Fresh clone on this Mac. The Convex CLI is now linked (with Shawn's OK) to the existing dev deployment `intent-donkey-676` (team `shawn-hiatt-39210`, project `food-recalls`). `.env.local` is written, and main's code was pushed to dev with `convex dev --once`. Prod was only read. Nothing else changed in code.

### Health

| Check | Result |
|---|---|
| `npm ci` | OK (Node 26.13, npm 11.20). `npm audit`: 27 vulns, 4 critical, incl. `next` 15.5.20 (Server Actions DoS) and `@auth/core` (email-normalizer homoglyph bypass, relevant to OTP sign-in) |
| `npm test` | 279/279 pass, 28 files |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 1 warning (unused eslint-disable in `app/search/page.tsx:63`) |
| `npm run build` | OK |
| Prod web (Vercel) | 200, though the cold first load took ~8.6s |
| Prod Convex crons | Alive: openFDA's daily ingest last succeeded 2026-11-11 09:15 UTC |
| `fda` source | current. Newest recall in the feed is dated 2026-10-09 (openFDA lags; normal) |
| `fda_rss` source | **unavailable. Last success 2026-10-24, 145 consecutive failures.** Prod's `sourceHealth.lastError` is `HTTP 401 for https://www.fda.gov/.../rss-feeds/recalls/rss.xml`. From this Mac the same URL answers 200, even with the app's User-Agent, and has items through 2026-11-10. So fda.gov now appears to block Convex's cloud egress, joining FSIS and CDC. openFDA (`api.fda.gov`) is unaffected |
| `fsis` / `cdc` | Still 403 upstream (rechecked today), never succeeded on prod. Unchanged since July |

### Figma

No Figma links in this repo or the sibling projects' docs. The Figma connector (signed in as Shawn, "SH" Pro team) can't list files, so Shawn needs to check his Figma recents. SPEC §12 mentions "the prototype's CSS theme", so some prototype existed (maybe Figma Make or v0).

### iOS planning notes so far

- Reverses SPEC §17.1 ("PWA, not native") and §16 ("native app builds" out of scope). Log it in SPEC when the iOS plan lands.
- **Auth is the big difference from Holy Grails.** HG sidesteps convex-swift's auth bugs by passing a `sessionToken` argument. Food Recalls uses Convex Auth (JWT, email OTP), which points to `ConvexClientWithAuth`. That client has an open use-after-free crash on resume (#26 per HG SPEC §5.2, as of 2026-10-12). Options to weigh in the plan: a custom `AuthProvider` over Convex Auth's sign-in action, or a session-token path added to the backend.
- Native wins: APNs push (needs a new Convex Node action plus a `.p8` key; the web-push redaction rules carry over), VisionKit `DataScannerViewController` for barcodes, widgets ("all clear / N matches"), and Live Activities probably not needed.

### Next

Shawn to confirm the order of the work (audit → Figma baseline → UX audit → iOS-first redesign → iOS plan) and answer the open questions in the main session.
