# HANDOFF — Food Recalls

Where the last session stopped. Newest entry first.

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
