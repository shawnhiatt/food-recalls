# Health & functionality audit — 2026-11-11

Scope: ingest health (FDA press RSS, FSIS, CDC), dependencies, and a no-sign-in smoke
test of prod (https://food-recalls-nu.vercel.app, Convex `good-lynx-479`). Diagnose and
recommend only: **nothing in prod was changed.** The one code change is a patch-level
dependency upgrade in this branch (§ Dependencies), not deployed.

Method and limits:
- Prod data came from **public** Convex queries only (`sourceHealth:getPublicStatus`,
  `recalls:list`, `recalls:search`, `recalls:get`) over plain HTTPS. I did not run any
  `npx convex … --prod` commands. The `fda_rss` `lastError` and failure counts below
  come from the coordinator session's read-only `npx convex data sourceHealth --prod`
  on the same day.
- Live upstream checks used one request per URL, sent with the app's own
  User-Agent from Shawn's Mac (a residential IP). I didn't run any header or
  User-Agent rotation.
- Not tested: anything behind sign-in (scanner, pantry, Saved, Household), push, email
  delivery, and requests from Convex's own egress (that needs a dev deploy; see ticket T2).

## Summary

| # | Severity | Finding |
|---|---|---|
| 1 | **High** | FDA press ingest (`fda_rss`) has been down since 2026-10-24. fda.gov's Akamai bot manager now returns `HTTP 401` to Convex's egress IPs. Relink and the Open Food Facts fallback broke with it. |
| 2 | **High** | UPCs are only extracted from `code_info`. About half of recent recalls carry their UPCs in the product description, so the scanner, pantry and digit search miss them. |
| 3 | **High** | Degradation alerting is effectively blind. FSIS/CDC have been permanently degraded since July, so a new failure changes nothing visible. The operator alert fires once, on the current→degraded edge only. |
| 4 | Medium | Next 15.5.20 has 14 advisories (4 critical). Real exposure on Vercel is low (no Server Actions, `next/image`, rewrites or custom server). Patched to 15.5.29 on this branch. |
| 5 | Medium | Press↔recall matching truncates its candidate window (`take(600)` / `take(500)`, ascending). Newer recalls fall outside it, which helps explain 1–6% photo coverage Jul–Sep. |
| 6 | Medium | A malformed `/recalls/<id>` or `/outbreaks/<id>` crashes the whole app ("Application error"). There are no `error.tsx` boundaries anywhere. |
| 7 | Medium | FSIS and CDC are still 403. FSIS and cdc.gov now 403 even plain curl from a residential IP. Options and a recommendation are below. |
| 8 | Low | `@auth/core` critical (email-normalizer homoglyph) **isn't reachable** through Convex Auth's email OTP. Patched anyway. |
| 9 | Low | vitest/tinypool criticals are dev-only (the test runner isn't shipped and no UI server is used). A major-version bump is needed. |
| 10 | Low | The ~8.6s cold first load isn't bundle weight (141 kB first-load JS). The Vercel cold start measures ~1.9s TTFB. I couldn't reproduce 8.6s. |
| 11 | Low | Copy and polish: the disclaimer omits FDA press releases, search cards show multi-KB product descriptions untruncated, and unknown detail IDs return HTTP 200. |

Healthy: openFDA ingest is current (last success 2026-11-11). The §10 reassurance gate
behaves correctly. The feed banner reads "Coverage incomplete — USDA meat & poultry
data, FDA press release data & CDC outbreak data haven't updated recently. No matches
in the data we have." and the header pill says "Unavailable". The feed, detail and search
pages render. The manifest is valid (name, id, scope, standalone, theme, 192/512 +
maskable icons all 200). The service worker is registered and controlling the page, and
`/offline` is precached. There were no console errors on the feed. Tests are 279/279,
typecheck passes, lint has 1 warning, and the build is green both before and after the
upgrade.

---

## 1. FDA press ingest down since 2026-10-24 — High

**Evidence**
- `sourceHealth` (prod) reports `fda_rss` with state `unavailable`, `lastSuccessAt`
  1792833367417 (2026-10-24 09:16 UTC), `consecutiveFailures` 145, and `lastError`
  `HTTP 401 for https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml`.
- The same URL from the Mac with the app's User-Agent returns `200 application/rss+xml`,
  20 items, newest 2026-11-10. The response sets **Akamai Bot Manager cookies**
  (`_abck`, `bm_sz`). That's new protection on www.fda.gov: a 401 that only cloud IPs get
  means IP-reputation or bot scoring, not anything in our request.
- **The feed format hasn't changed.** `parseRssItems` (unchanged code, run under Node 26)
  parses all 20 live items, with correct `publishedAt`, `guid === url` and titles. Links
  are still `http://` and redirect to https, which `fetch` follows. So this isn't a parse
  failure, a date change or the zero-record anomaly path. The run throws at
  `fetchText(RSS_URL)` before any of those.
- Convex documents its egress as a **fixed range shared by every Convex customer in the
  region**: US-East `216.235.222.0/24`
  ([docs.convex.dev/production/networking](https://docs.convex.dev/production/networking)).
  One noisy tenant can get the whole /24 flagged, and an agency allowlist would have to
  cover every Convex app.

**Blast radius (wider than "no photos")**
- `convex/ingest/fdaRss.ts` runs the feed fetch, page fetches, `relinkUnmatched` and the
  Open Food Facts fallback **in one try block**. The RSS fetch throws first, so
  relink and OFF have also not run since 2026-10-24, even though neither needs fda.gov.
- A concrete example: the "Riad's Oliva to Go Spicy Baba Ghanouj" recall (Class I,
  undeclared sesame, 2026-10-09). Its FDA press release is in the RSS feed and was
  probably fetched before the outage. Its openFDA record landed later, and the relink
  that would join them hasn't run. So prod's "View official source" link goes to raw
  JSON (`https://api.fda.gov/food/enforcement.json?search=recall_number:"H-0180-2027"`),
  and the recall has no photo and no risk groups.
- `convex/images.ts` mirrors bookmarked or matched images by calling `fetch` on fda.gov
  `/files/` URLs from Convex. It will hit the same wall. That's inferred, not
  log-verified.
- **There's a recovery deadline.** The feed holds about 20 items (~32 days: 2026-10-09 →
  2026-11-10). Anything published since the outage stays recoverable from the feed
  until about **2026-11-24**. After that, missed items need a backfill from FDA's
  recalls listing.

**Recommended fix**
1. *Now, small, no new infra:* split the action so `relinkUnmatched` and the OFF
   fallback run (and report) even when the feed fetch fails. Give the step a distinct
   log tag. This restores enrichment for press items already in the DB.
2. *Find out which egress can reach fda.gov* (ticket T2). Run a throwaway internal
   action on **dev** Convex plus a Vercel route handler on a preview deploy, each
   fetching the RSS URL and one press page and reporting status codes.
3. Pick the transport (see "Upstream access options" under §7). If Vercel gets 200, a Vercel
   Cron relay is cheapest: fetch the feed and pages, then POST them to a Convex HTTP
   action with a shared secret. If not, use the email-ingest path for FSIS/CDC and add FDA
   to it.

## 2. UPCs only extracted from `code_info` — High

**Evidence**
- `extractProductCodes` (`convex/adapters/openfda.ts:95,112` → the helper at line 114)
  runs only over `record.code_info`.
- Of the 1,000 most recent feed recalls, read via public `recalls:list`, **211** have any
  `productCodes`. **513** have no `productCodes` but mention `UPC`/`GTIN` or carry a
  10–17-character digit run in `productDesc`. That heuristic over-counts somewhat
  (some digit runs are lot or phone numbers), but the gap is clearly large.
- Reproduced on prod: searching `8 10149-37056 4`, the UPC exactly as printed in the
  2024-06-17 Snapchill recall, finds it through the description text. Searching
  `810149370564`, the same UPC as a scanner or a person types it, returns "Nothing
  matches". That record's `productCodes` is `[]` and its `code_info` holds only
  expiration dates.
- Consequence: the scanner's exact-UPC rung, pantry auto-matching (`convex/lib/pantry.ts`
  `matchByUpc`) and digit search all miss about half of recalls. The §3 promise ("no
  known recall" is honest) still holds, but the scanner is much weaker than it looks.
  This matters for iOS, where the scanner is likely a headline feature.

**Recommended fix**
- Run `extractProductCodes` over `product_description` as well as `code_info`. Prefer
  runs near `UPC`/`GTIN`/`EAN` keywords to keep lot-number noise down. Add fixtures for
  description-embedded UPCs.
- Normalize at match time too: strip non-digits, and compare UPC-A (12) against EAN-13
  with a leading zero. Check what `@zxing` returns for UPC-A on iOS and Android.
- Then re-run the ingest backfill. The 2026-07-12 hash-stability rule (same raw → silent
  tag refresh) means this can't fan out notifications, but confirm it with a test, since
  `productCodes` is a hash-material field. Also re-run the `searchText` migration.

## 3. Degradation alerting is blind to new failures — High

**Evidence**
- `reportRun` emails the operator only on the **current → degraded** edge
  (`convex/sourceHealth.ts`). `fda_rss` would have crossed it around 2026-10-24 18:16 UTC
  (more than 6h without a success). After that, nothing re-alerts, and delayed → unavailable
  doesn't alert either.
- FSIS and CDC have been degraded since July. So the feed banner, the header pill and the
  digest footer have all said "coverage incomplete" for four months. When `fda_rss`
  broke, the only visible change was three extra words in the banner. The outage ran 18
  days and was found by accident during orientation.
- Not verified: whether the 2026-10-24 operator email actually arrived. **Question for
  Shawn:** did you get a "fda_rss degraded" email around 2026-10-24? If not, the alert
  path (Resend `OPERATOR_EMAIL`) is broken too, and that should be checked in the
  dashboard logs.

**Recommended fix**
- Alert on every state worsening (current→delayed→unavailable), plus a weekly
  "still degraded" summary per source, carrying `lastError` and the failure count.
- Keep known-permanent degradations separate from new ones. For example, add an
  `acknowledged` flag (or an expected-state field) per source, so FSIS/CDC can be
  acknowledged while any *other* source going down alerts loudly. The user-facing §10
  gate must still treat acknowledged sources as degraded.
- Optionally add a "source health" line to the operator's own digest with the last error
  per source.

## 4. Next.js advisories — Medium (patched on this branch)

`next@15.5.20` had 14 advisories, including critical RCEs in the Image Optimization API
(AVIF/SVG), an RCE on Windows hosts, Server Actions DoS/SSRF, and rewrite SSRF. How they
apply to this app:
- **No Server Actions**: there's no `"use server"` anywhere. The App Router's action
  dispatch still exists, so the Server Actions DoS advisories may still be reachable by
  a crafted `Next-Action` POST. That's the realistic residual risk.
- **`next/image` isn't used.** `RecallImage` renders a plain `<img>`, and
  `next.config.ts` sets no `remotePatterns`. On Vercel, `/_next/image` runs on Vercel's
  optimizer, not the app's `sharp`. The image RCEs are effectively unreachable.
- No rewrites, no custom server, and Vercel runs Linux, so the SSRF-in-rewrites,
  custom-server and Windows RCE advisories don't apply. Middleware
  (`convexAuthNextjsMiddleware`) runs on every route but isn't named in any advisory.

**Fix (done on this branch, not deployed):** `next` and `eslint-config-next` 15.5.20 →
**15.5.29** (latest 15.5.x), which clears every Next advisory. The one residual is Next's
bundled `postcss@8.4.31`, which only processes our own CSS at build time and is fixed
only in Next 16.

## 5. Press↔recall matching window truncation — Medium

**Evidence**
- `relinkUnmatched` (`convex/press.ts`) scans recalls from `oldest pending − 120d`
  **ascending, `take(600)`**. Unmatched items stay pending for up to 180 days, and many
  FDA press items never get an openFDA twin (drugs that slip the food filter,
  non-enforcement notices). So the oldest pending item pins the window start. I simulated
  it against prod's real recall density: with an item pending from 2026-07-15, the 600
  candidates stop at **2026-08-06**. A press item from September can never match a
  September recall while that older item is pending.
- `recordPressItem`'s `matchingRecalls` does the same with `take(500)` over a ±120-day
  window. That truncates the newest end in dense months (Apr–May 2026 had ~215
  recalls/month).
- Photo coverage on prod, from the 1,400 most recent feed rows: Jul 6/69, Aug 2/159
  (plus 2 OFF), Sep 1/47, Oct 0/16. None of the first 20 feed cards has a photo. That
  undercuts the §3 photo strategy, and it matters for the iOS visual design.
- The 16 MB read-limit concern in the code comment isn't the problem today. Recall docs
  average ~2.7 KB (p99 4.9 KB), so 600 docs is about 1.6 MB.

**Recommended fix:** scan per item using a bounded `[start, end]` range on
`by_recall_date`, or descending from `newest pending + 120d`. Cap pending items by
*attempt count* or age as well as by `RELINK_BATCH`. Add a test with an old pending
item plus a recent matchable pair. After this and #1 land, re-measure photo coverage.

## 6. Malformed detail IDs crash the app — Medium

**Evidence:** on prod, `/recalls/k971jewaqntgz62pk9s0kybdps8hz5pX` (a valid ID with its last
character changed) renders "Application error: a client-side exception has occurred".
The console shows `Uncaught Error: [CONVEX Q(recalls:get)] … Server Error`, because the
`v.id("recalls")` arg validator throws. The app has no `error.tsx`, `not-found.tsx` or
`global-error.tsx`. Real triggers are links truncated in SMS or email, old shared links
and push deep links. The same pattern applies to `outbreaks:get` (`v.id("outbreaks")`).

**Recommended fix:** make `get` accept `v.string()`, use `ctx.db.normalizeId` and return
`null`. Render a friendly "This alert isn't available" state. Add `app/error.tsx` and
`app/global-error.tsx` so any future query error degrades to a page rather than a blank
crash. Optionally return a real 404 status for unknown IDs; today they return 200.

## 7. FSIS and CDC 403s — Medium (unchanged since July)

**Recheck (2026-11-11, single requests from the Mac, app User-Agent):**

| URL | Result |
|---|---|
| `https://www.fsis.usda.gov/fsis/api/recall/v/1` (adapter) | 403 |
| `https://www.fsis.usda.gov/fsis-content/rss/recalls.xml` (FSIS RSS) | 403 |
| `https://www.fsis.usda.gov/news-events/news-feeds-subscriptions` (via WebFetch) | 403 |
| `https://www.cdc.gov/outbreaks/index.html` (adapter) | 403 |
| `https://tools.cdc.gov/api/v2/resources/media…` (CDC syndication API) | 200, but stale or unrelated content with no current investigations, so not a substitute |
| `https://api.fda.gov/food/enforcement.json` (openFDA) | 200 (and current on prod) |

FSIS and cdc.gov now refuse plain clients **even from a residential IP**. That's
TLS or bot fingerprinting, not IP reputation, so a residential relay without a real
browser won't help them. fda.gov is the other way round: it serves residential IPs fine
and blocks cloud ones.

**Upstream access options (FSIS, CDC, and now FDA press)**

| Option | Cost | Effort | Reliability | Notes |
|---|---|---|---|---|
| **A. Ask agencies to allowlist or fix** | $0 | ~1h (emails) | Low odds, slow | Still worth doing. FSIS's *documented* recall API returning 403 to every non-browser client is arguably a bug on their side. Allowlisting the Convex /24 means allowlisting every Convex app, so ask for an API key or token instead. |
| **B. Email ingest (recommended for FSIS + CDC)** | $0 (Cloudflare Email Routing → Email Worker, or a Resend/Postmark inbound plan) | 2–3 days | High (push-based, official) | Subscribe a dedicated address to FSIS "Recalls & Public Health Alerts" and CDC food-safety outbreak updates (both via GovDelivery). The worker POSTs the parsed message to a Convex HTTP action. Adapters parse the email body, which has a title, establishment/firm, products, states and a link. It isn't IP- or fingerprint-dependent and isn't scraping. Downsides: email bodies are thinner than the API (no structured fields; the detail page fetch is still blocked), and parsers need fixtures. Add FDA's recall emails for redundancy. |
| **C. Vercel Cron relay** | $0 (Hobby) / static IPs on paid plans | ~0.5 day | Unknown until probed (T2) | Only plausible for fda.gov, which blocks by IP. FSIS/CDC fingerprint-block, so this won't help them. |
| **D. Commercial unblocker API** (ScrapingBee, ZenRows, ScraperAPI, Bright Data) | ~$49–69/mo entry plans. Protected pages cost ~10–25 credits each; ~100 req/day ≈ 3k req/mo fits the entry tier | ~0.5 day | High | Works for all three hosts, but it deliberately bypasses the agencies' bot controls (ToS-grey), puts a third party in the data path, and is a recurring cost for a personal tool. Pricing varies by source; verify before buying. |
| **E. Home relay with a real browser** (Playwright on a Mac or Pi) | $0 | 1–2 days | Medium (home uptime) | Same bypass concern as D. Fragile, because headless Chrome is also fingerprinted. |

**Recommendation:** do **A** now (it costs nothing). Build **B** for FSIS and CDC as the
durable path. Use **C** for fda.gov if the T2 probe shows Vercel gets 200, otherwise fold
FDA into B. Keep D in reserve if Shawn wants full structured FSIS data and accepts the
cost and the ToS posture. For the iOS plan: source reliability is a server-side
prerequisite. Don't count on on-device fetching, because matching and notifications run on
the server.

## 8. `@auth/core` critical isn't reachable — Low (patched)

Advisories: GHSA-7rqj-j65f-68wh (email normalizer validates before Unicode normalization,
which allows a homoglyph `@`), GHSA-xmf8-cvqr-rfgj (`getToken()` throws on a malformed
Bearer header) and GHSA-x445-f3h2-j279 (OAuth check cookies not bound to the provider).

How they interact with Convex Auth email OTP:
- `@convex-dev/auth` imports only `setEnvDefaults` and OAuth types/helpers from
  `@auth/core`. Its `Email` provider has no `normalizeIdentifier`, and the
  sign-in flow is Convex Auth's own, not Auth.js's `send-token` path. So the vulnerable
  normalizer never runs.
- The OTP `authorize` check requires the verifying email to equal the issuing one exactly.
  `claimMemberForUser` binds by exact `email.toLowerCase()` match. A homoglyph address
  is a different string, so it can't claim another member's row, and the attacker would
  still need the code sent to that address.
- There are no OAuth providers and no `getToken()` use, so the other two don't apply.
- Adjacent (not a vuln): `toLowerCase()` without NFKC normalization means visually identical
  Unicode addresses are distinct accounts. Worth adding `normalize("NFKC")` in
  `lib/members.ts` when touching auth for iOS.

**Fix (done on this branch):** 0.41.1 → 0.41.3, within `@convex-dev/auth`'s peer range
(`^0.41.1`).

## 9. Dev-tool criticals (vitest, tinypool, vite, esbuild) — Low

These run only in `npm test` locally. None ships to Vercel or Convex. The tinypool RCE
needs attacker-controlled worker options, and the Vitest UI-server issue needs `vitest
--ui`, which isn't used. The fix is `vitest` 2 → 5 plus `convex-test` 0.0.35 → 0.0.69 (a
major jump; the test harness may need edits). That's a separate ticket, not done here.

## 10. Cold first load — Low

- Bundle: `/` is 141 kB first-load JS (104 kB shared). Every route is dynamic (`ƒ`), and
  middleware runs on every request.
- `curl` against prod, first request then warm: `/` TTFB **1.92s**, then 0.29s.
  `/search` 0.19s, `/scanner` 0.32s. Headers show `x-vercel-cache: MISS`, `cache-control:
  no-store`, region `iad1`.
- Warm browser load: TTFB 183 ms, FCP 560 ms, load 561 ms. After hydration the feed
  prefetches the RSC payload of every visible `/recalls/[id]` link (about 20 dynamic
  function calls, each up to ~1.5s). That's harmless warm, but on a cold deploy it fans
  out cold starts.
- So roughly 1.6s of a cold load is Vercel function cold start, not app weight. I
  couldn't reproduce 8.6s. It was most likely a first-ever visit (service worker install
  plus precache), a cold Convex WebSocket and auth refresh, and network throttling
  stacked together. If it matters for the web app's future, measure with WebPageTest
  "first view". Cheap wins: `prefetch={false}` on feed cards, and making the feed shell
  static, since all data is client-side via Convex anyway.

## 11. Copy and polish — Low

- The footer and first-run disclaimer say "Data comes from openFDA, USDA FSIS, and CDC",
  which omits FDA press releases (and Open Food Facts images). The detail-page footer says
  "Data from openFDA/FSIS".
- Search result cards render the full `productDesc`. The 2024 Snapchill coffee recall
  shows about 2 KB of brand list. Clamp it to 2–3 lines. (A UX audit item; noted for
  the Figma baseline.)
- Unknown detail IDs return HTTP 200 (client-rendered). That's only a problem if SEO
  matters, which it does once the site goes public.

---

## Dependencies — currency and upgrade plan

| Package | Installed | Latest | Plan |
|---|---|---|---|
| next | 15.5.20 | 16.4.6 (15.5.29 latest 15.x) | **→ 15.5.29 on this branch.** Defer 16 until the iOS plan settles the web app's role; the only residual is build-time postcss. |
| eslint-config-next | 15.x | 16.4.6 | → 15.5.29 with next |
| @auth/core | 0.41.1 | 0.41.3 | **→ 0.41.3 on this branch** |
| serwist / @serwist/next | 9.5.11 | 9.5.13 | **→ 9.5.13 on this branch.** Its `zod@4.6.5` (high, build-time) stays until serwist bumps it; an `overrides` entry for `zod@^4.6.6` is an option. |
| convex | 1.42.1 | 1.49.0 | Ticket: minor bump, verify with a dev deploy. It changes the deploy CLI, so don't mix it with the security patch. |
| @convex-dev/auth | 0.0.94 | 0.0.98 | Ticket with convex. 0.0.x, so read the changelog. Relevant to iOS (`ConvexClientWithAuth`). |
| convex-test | 0.0.35 | 0.0.69 | Ticket with vitest 5 |
| vitest | 2.1.9 | 5.1.0 | Ticket (dev-only criticals) |

**Branch result:** `npm audit` drops from 27 (4 critical / 12 high) to **20 (2 critical / 7 high)**.
The remaining criticals are vitest and tinypool (dev-only); the highs are serwist build
tooling, postcss inside Next, vite and brace-expansion (all dev or build-time). Tests are
279/279, typecheck is clean, lint has 1 pre-existing warning (`app/search/page.tsx:63`
unused disable), and `next build` succeeds. Note: npm's install-scripts policy skipped
postinstall for `sharp`, `esbuild` and `unrs-resolver`, and the build and tests still pass.
Vercel runs its own install. **Not deployed.** Merging to `main` deploys to Vercel, so
that step needs Shawn's go-ahead.

---

## Proposed fix tickets (for the coordinator)

Ordered by value ÷ effort. Each is one concern.

- **T1 — Decouple press ingest steps** (fdaRss.ts). Run relink and the OFF fallback even
  when the feed fetch fails, with separate error logging. ~1–2h, with tests. Restores
  enrichment for already-fetched press items. *Do before 2026-11-24.*
- **T2 — Egress probe** (dev only). A throwaway Convex internal action on **dev** plus a
  Vercel preview route that fetch the FDA RSS URL, one press page, one fda.gov image,
  FSIS API/RSS and CDC outbreaks, and report the status codes. It decides between C, B
  and D. ~1h, but needs Shawn's OK to deploy to dev and a preview.
- **T3 — UPC extraction from product descriptions** (+ match-time normalization, fixtures,
  backfill and search-text re-migration). ~0.5–1 day. Biggest functional win for the
  scanner and iOS.
- **T4 — Alerting that notices new failures**: alert on every worsening, a weekly
  still-degraded reminder, and per-source acknowledgement for FSIS/CDC. Also confirm
  whether the 2026-10-24 operator email arrived. ~0.5 day.
- **T5 — Restore FDA press transport** per the T2 result: a Vercel Cron relay to a Convex
  HTTP action, or fold into T7. ~0.5 day, plus a backfill of items missed since 10-24.
- **T6 — Press-match window fix** (bounded per-item range, pending-item aging, test).
  ~2–3h. Then re-measure photo coverage.
- **T7 — Email ingest for FSIS + CDC** (GovDelivery subscriptions → inbound worker →
  Convex HTTP action → adapters with fixtures). 2–3 days. Plus option A, the agency
  emails, which Shawn sends.
- **T8 — Error boundaries + safe `get` by ID** (recalls and outbreaks), with a friendly
  missing-alert state. ~1–2h.
- **T9 — Ship the patch upgrade** (this branch's dependency commit): merge after review,
  then deploy. Shawn's call.
- **T10 — vitest 5 + convex-test bump** (dev-only). ~0.5 day.
- **T11 — convex 1.49 + @convex-dev/auth 0.0.98**, verified on dev. Fold into iOS prep.
- **T12 — Copy nits**: disclaimer sources, clamping search-card descriptions. Fold into
  the UX audit.
