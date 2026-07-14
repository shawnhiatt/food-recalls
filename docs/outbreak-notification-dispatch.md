# Plan: outbreak notification dispatch (TODO #8, SPEC.md §4/§9)

Wire the `outbreak` alertType through `convex/notifications.ts` for instant +
digest delivery. Recalls already dispatch; outbreaks never have. Scoped
2026-07-14 after reading the full notification path; not yet implemented.

## Why it's more than "mirror recalls"

The §9 core is deliberately delicate (at-most-once, per-revision dedupe — a bug
here means a missed or duplicated *safety* alert). And §11 gives outbreaks a
distinct "be aware" voice, so the recall-shaped digest/email copy can't just be
reused. The plan below is **additive** — it adds outbreak render paths and a
parallel dispatch fn without touching recall copy or its tests.

## What already exists (don't rebuild)

- `notificationsSent` / `digestQueue` schema already carry `alertType: "outbreak"`.
- `matchRecall` is already generic: `MatchableAlert` has `suspectedFood`, and
  `tests/matching.test.ts` covers outbreak-shaped alerts. It gates by `audience`
  → outbreaks pass `audience: "human"` (so they're also humanFood-gated; see
  `tests/matching.test.ts:222`). The separate `categories.outbreaks` toggle is
  meant to be checked **upstream in the dispatch layer**, not in the matcher.
- `outbreaks.ts` has the `search` query and upsert; upsert does NOT schedule any
  dispatch (see its header comment — dispatch was intentionally deferred).

## Design

1. **Severity** (`convex/lib/matching.ts` or inline): an *active* outbreak is
   Class I-equivalent for alerting (§4) → `severity = "class1"`. A resolved
   outbreak never notifies as new (mirrors closed recalls).

2. **Outbreak → MatchableAlert adapter** (pure, testable):
   `{ audience: "human", states, productDesc: "", firm: "", allergens: [],
      riskGroups, suspectedFood, distribution: undefined }`.
   Outbreaks have `riskGroups` (drives the hard floor) and `suspectedFood`
   (brand/keyword text); no allergens/firm/distribution.

3. **Freshness guard**: reuse `isFreshForNotification(publishedAt, now)` — the
   outbreak's `publishedAt` plays `recallDate`'s role. Guards the backfill from
   blasting old outbreaks.

4. **`dispatchForOutbreak` internalMutation** `(outbreakId, event: "new" |
   "material" | "resolution")`, mirroring `dispatchForRecall`:
   - Upstream gate: `if (!prefs.categories.outbreaks) continue;` per household.
   - `event === "resolution"` ≙ recall "closure" (status active → resolved):
     drop pending match lines, enqueue a closure line only for previously-emailed
     members, email-only, category still enabled.
   - Hard floor: active (class1) + risk-group match → instant (per `decideRoute`,
     already generic). Otherwise threshold decides instant vs digest.
   - Dedupe identical: `notificationsSent` on `(member, alertId=outbreak._id,
     channel, contentHash)`, `alertType: "outbreak"`. Claim-before-send.

5. **Additive rendering** (keep recall paths + their tests untouched):
   - `convex/lib/email.ts`: `outbreakInstantSubject` + `renderOutbreakInstantText`
     — "be aware" voice, `pathogen` instead of `firm`, optional case count, link
     to `/outbreaks/{id}`. New `OutbreakInstantAlert` type.
   - `convex/lib/push.ts`: outbreak push payload variant (instant-only; never
     sends resolution lines — same rule as recall closures).
   - `convex/lib/digest.ts`: `DigestOutbreakItem { kind: "outbreak", title,
     pathogen, url }`; render a separate "Active outbreaks — be aware:" section;
     have `digestSubject`/body count outbreaks only when present (guard keeps the
     existing recall-only tests green).

6. **`drainDueDigests`**: branch on `row.alertType === "outbreak"` → fetch from
   `outbreaks` table (not `recalls`), build a `DigestOutbreakItem`; skip a
   closure line if the outbreak went back to active.

7. **`outbreaks.upsertBatch`**: schedule `dispatchForOutbreak` on insert (event
   "new", fresh only), material update ("material"), and an active→resolved
   transition ("resolution") — mirroring recalls' scheduling and its
   closed→closed guard.

8. **URL helper**: `outbreakUrl(id) = ${appBase()}/outbreaks/${id}` in
   `notifications.ts`.

## Tests

- Mirror `tests/notifications.test.ts` for outbreaks: new active outbreak →
  instant/digest per threshold; hard floor (risk-group) → instant; resolution →
  closure line for previously-notified only; `categories.outbreaks` off →
  nothing; at-most-once dedupe on replay; stale (old `publishedAt`) new outbreak
  → no dispatch.
- Digest outbreak-item rendering + mixed recall/outbreak digest.
- Outbreak instant email/push copy.
- Confirm all existing recall notification tests still pass unchanged.

## Non-goals

- No change to recall copy, recall dispatch, or their tests.
- Chain matching is N/A for outbreaks (no `distribution`).
