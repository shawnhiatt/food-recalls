# WCAG 2.2 AA audit — onboarding, feed, detail (§14 Phase 5)

Structural/automated pass done 2026-07-18 against the running dev app (feed,
recall/outbreak detail, onboarding, scanner, search). Verified via the
accessibility tree (screen-reader semantics), keyboard-focus checks, and
computed-style contrast math.

## Issues found and fixed

| Criterion | Issue | Fix |
|---|---|---|
| 1.3.1 / 2.4.6 Info & Relationships, Headings | The **feed** (home page) had no `h1`, and card titles were `h3` — the page's heading outline started at `h3`. | Added an sr-only `h1` and an sr-only `h2` for the main list, giving a clean `h1 → h2 → h3` outline (`app/page.tsx`). The matched section's existing `h2` slots in correctly. |
| 2.4.7 Focus Visible | The filter-chip `<select>`s and the onboarding member-name `<input>` used `outline-none` with no replacement — keyboard focus was invisible. | Filter pills now show a 2px brand `focus-within` outline; the input shows a `focus-visible` outline (`FilterBar.tsx`, `OnboardingWizard.tsx`). Verified: focused select → 2px `rgb(43,126,167)` outline on the pill. |

## Verified already-conformant

- **1.1.1 Non-text content** — `RecallImage`/`OutbreakImage` take a required
  `alt`; icon-only controls (search, dismiss, bookmark, nav) carry `aria-label`.
- **1.3.1 Forms** — filter selects, the manual-UPC field, and the search box
  have associated `<label>`s or `aria-label`s.
- **1.4.3 Contrast** — muted text 4.60:1, body text 16.0:1 on the light
  background (both pass AA for normal text).
- **2.4.1 / landmarks** — `banner`, `main`, `status`, `note`, and labeled
  `group` regions are present.
- **2.5.8 Target size** — interactive rows use `min-h-11`/`min-h-[44px]`,
  `py-3`, or the 56px nav targets.
- Detail views (`RecallDetail`, `OutbreakDetail`) and `OnboardingWizard`
  already have `h1` + `h2` section structure.

## Residual — needs manual assistive-tech testing (not automatable here)

- A real screen-reader pass (NVDA + VoiceOver) for reading order and live-region
  announcements (the source-health banner is a `status` region).
- Full keyboard traversal of the onboarding wizard and the camera scanner flow.
- Dark-mode contrast: the app's dark palette isn't `prefers-color-scheme`-driven,
  so it couldn't be exercised from the automated harness; re-check the dark
  tokens' muted-on-surface ratios when toggled in-app.
