# UX and visual audit (2026-11-11)

This pass covers the Food Recalls PWA as it ships today. Its job is to feed an iOS-first redesign, so it audits and recommends only. No app code was changed.

**Inputs**
- The Figma baseline "Food Recalls — PWA baseline (2026-11)" (`XyJxXlBeqLsJFmPeoC68Qm`): 60 frames in 9 flows plus 34 annotation notes. Frame names below are the Baseline page's frame names.
- The health audit (`docs/audits/2026-11-health-audit.md` on `claude/health-audit-1457c0`).
- SPEC §1, §3, §7–§12, and `docs/wcag-audit.md`.
- Source reading of `app/` and `components/`.
- A live check of `npm run dev:web` against dev Convex `intent-donkey-676` at 390pt, signed out. I measured computed styles, the accessibility text of the cards, and 200% text. Signed-in states come from the baseline frames, which were captured with the dev test household.

**Figma.** The file's **Audit** page (`70:15`) has the ranked table, with links to the Baseline frames, and 11 cropped copies of Baseline frames carrying numbered callouts that match the UX-NN IDs below. The Baseline frames themselves are unchanged.

**Scoring.** Impact is H/M/L: how much the finding damages the three SPEC §1 questions, or how many screens it touches. Effort is S/M/L: design plus build for the iOS app, including any backend change. Findings are ranked by impact over effort, then by impact. Every finding ends with an **iOS** line that says what to keep, drop, or do natively.

## Ranked summary

| # | Finding | Impact | Effort | Main frames |
|---|---|---|---|---|
| UX-01 | The coverage banner contradicts the screen ("No matches" above 562 matches) | H | S | Feed / For your household · Feed / First visit |
| UX-02 | Hazard placeholders render as black glyphs on white, because the tint tokens never reach the CSS | H | S | Feed / Degraded (dev) · Search / Results "peanut" |
| UX-03 | "Match" means too little: three different counts, and most matches are state-only | H | M | Feed / For your household · Feed / Matched us |
| UX-04 | Question 3 has no answer in the app: there is no designed "nothing affects you" state | H | M | Feed / For your household · (all-clear not reachable) |
| UX-05 | Permanent degradation has worn out the warning: the banner and red pill have been on for 4 months | H | M | Every frame (header) · Feed / Degraded banner |
| UX-06 | Titles are raw openFDA product strings: clamped mid-phrase on cards, 9+ lines on detail | H | M | Feed · Recall detail / 320 check |
| UX-07 | Detail doesn't say why it was recalled or what to do | H | M | Recall detail / * |
| UX-08 | Scanner outcomes are lists of links rather than verdicts, and the scanner misses about half of UPCs | H | M | Scanner / Possible match · Match · No known recall |
| UX-09 | Large text breaks the layout, and screen readers hear the whole product string | H | M | Feed / 320 check · Onboarding 2 · 4 |
| UX-10 | The severity-color quarantine is broken: red marks status, counts and "possible" | M | S | Every frame (header, nav) · Scanner / Match |
| UX-11 | Copy leaks internals and raw agency text | M | S | Household / Full view · Recall detail / UPDATE timeline · Scanner |
| UX-12 | Reason chips are inconsistent and sometimes wrong | M | S | Feed / For your household · Matched us |
| UX-13 | Error and edge states are dead ends, or crash | M | S | Error / Malformed recall id · Unsubscribe / * · Invite / Invalid · Saved / Signed out |
| UX-14 | Onboarding drops answers and skips the alerts step SPEC describes | M | S | Onboarding 4 / Alerts · Onboarding 5 / Review · Household / Redo setup |
| UX-15 | The first visit stacks two notices before any content and never pitches the household | M | S | Feed / First visit (prod) |
| UX-16 | Nothing tells you what's new, and the feed sorts by a date that hides new arrivals | M | M | Feed / First visit (prod) |
| UX-17 | Feed hierarchy: the pinned section pushes the national feed two screens down, and the filters wrap | M | M | Feed / For your household · Feed / Filter: * |
| UX-18 | The visual system has drifted: 6 radii, 4 heavy weights, 10–11px text | M | M | Foundations |
| UX-19 | Household is one 1,884pt settings scroll | M | M | Household / Full view · 320 check |
| UX-20 | Search ranks old resolved recalls first | L | S | Search / Results "peanut" |

The top four together decide whether the app can be trusted. UX-01, UX-03, UX-04 and UX-05 are one design problem: the screen's top area has to answer the three questions in one place, with one number and one coverage statement. Design them together.

---

## Tier 1: trust and the three core questions

### UX-01 · The coverage banner contradicts the screen (H/S)
**Frames:** Feed / For your household, Feed / First visit (prod), Feed / Degraded banner, Feed / First run (dev).

**Evidence**
- `SourceHealthBanner.degradedMessage()` always ends "No matches in the data we have." The string is static and never looks at the household. Signed in, it sits directly above "For your household" and "See all 562 matches".
- Signed out, the same sentence talks about "matches" to someone who has no household to match against.
- The source list joins with commas and "&" and runs 3–4 lines at 390pt. Prod names 3 sources; dev names 4.

**Recommendation.** Split the two claims the banner merges:
1. **Coverage** is a fact about sources: which ones are behind, since when, and what that leaves out. For example: "USDA meat and poultry and CDC outbreaks haven't updated since July, so those recalls are missing."
2. **Matches** is a fact about the household. It comes from the same count as UX-03 and is never stated when signed out.

Only show "No matches in the data we have" when the household's count really is 0. SPEC §10's example sentence was written for that empty case; the banner reused it for every case.

**iOS:** Drop the dismissible banner. Coverage becomes one line in the household status card (UX-04). It is tappable and opens a "Sources" sheet (medium detent) that lists each source with its state, last success and scope.

### UX-02 · Hazard placeholders lose their tint (H/S)
**Frames:** Feed / Degraded (dev), Feed / First visit (prod), Search / Results "peanut", every card without a photo.

**Evidence**
- `ImagePlaceholder` builds `var(--color-hazard-${hazardType}-tint)` at runtime. Tailwind v4 only emits theme variables it finds in class names, so the tint and fg variables are missing from the compiled CSS.
- Live check on dev: `--color-hazard-microbial-tint`, `-allergen-tint` and `-allergen-fg` are all empty. The placeholder background computes to `rgba(0,0,0,0)` and the SVG fill falls back to black. `--color-hazard-outbreak-tint` survives because `OutbreakImage` names it literally, which is why only outbreak cards get the peach tile.
- Photo coverage is 0–6% (health audit §5), so this is what about 95% of cards show: a black star, dot cluster or clock on white. The baseline annotation "Placeholder glyphs read as decoration" is partly this bug.

**Recommendation**
- **Web, as a quick ticket:** declare the tokens with `@theme static`, or reference them literally.
- **Redesign:** treat the placeholder as the card's main visual, not a fallback. Photos will stay rare until T5/T6 land and press coverage improves. Each hazard type needs a glyph that reads as that hazard (bacteria, allergen, foreign object, other), on a tint that isn't confused with severity.

**iOS:** Put the tints in the asset catalog as named colors with dark variants. Use SF Symbols, or a small custom symbol set, for the hazard glyphs, so they scale with Dynamic Type.

### UX-03 · "Match" means too little, and there are three counts (H/M)
**Frames:** Feed / For your household, Feed / Matched us (See all), Recall detail / 320 check.

**Evidence**
- The nav badge shows "9+". Its screen-reader text says "394 alerts match your household" (active only). The section button says "See all 562 matches" (`myMatches` includes non-active recalls up to the 12-month archive cutoff). That's three numbers for one idea.
- Matching is OR across dimensions (SPEC §7), and "state" includes nationwide distribution. So nearly every nationwide recall "matches" a household in NC. Most of the 562 carry only the "Your state" chip. A count in the hundreds tells the user nothing, and it makes the badge permanently "9+".
- The pinned section ranks by severity first, so an allergen or infant-risk match can sit below a state-only Class I match from three weeks ago.

**Recommendation**
- Split matches into two tiers in the UI. The matcher already emits `matchedOn`, so most of this is presentation:
  - **"Affects your household":** allergen, risk group, pet, brand or keyword, pantry. These are specific to the household.
  - **"Sold in your state":** state-only or nationwide. This is context, not a personal match. Show it as a filter or a section, not as part of the count.
- Use **one number** everywhere: the badge, the section header, the widget, the digest subject. It counts active, tier-1 items only. Never show resolved items in the count.
- This changes what the badge and the "For your household" section mean (SPEC §8, §12), so log it in SPEC. Whether state-only matches still notify is §9's business and an open question below.

**iOS:** `TabView` badge (`.badge(n)`) with the exact number up to 99. The same number appears on the Home Screen and Lock Screen widget and in the app icon badge (granted with the notification permission). One query backs all of them.

### UX-04 · Question 3 has no answer in the app (H/M)
**Frames:** Feed / For your household. Not reached: the all-clear and "Current" states (see the baseline README).

**Evidence**
- `HouseholdMatchSection` returns `null` when there are no matches. Its comment explains why: "the section disappears rather than showing an empty box".
- `EmptyState`'s reassuring variant only renders when the whole national feed is empty, which never happens.
- The only "You're all clear" copy in the codebase is in the digest (`convex/lib/digest.ts:207`).
- So a household with zero matches and all sources current would see the national feed with no statement at all. Question 3 is answered only by email.
- Today it can't be answered anyway: 3 of 4 sources are blocked. But the redesign must draw the state now, or it will never exist.

**Recommendation.** Add a **household status card** as the first thing on Feed (signed in). It has three designed states and answers questions 2 and 3 in one sentence each:
- **Affects you:** "2 recalls affect your household" with the top one inline, then "See all".
- **Clear (gated by §10):** "Nothing affects your household. Checked 2 hours ago across all 4 sources."
- **Can't confirm:** "No matches in what we can see. USDA meat and poultry and CDC outbreaks are missing since July." It is tappable for detail.

Signed out, the card is the household pitch (UX-15).

**iOS:** This card is the **widget** (small: the state and the number; medium: plus the top item) and the content of the Lock Screen widget. Haptics: `.success` when a pull-to-refresh lands on Clear, nothing on the other states. Keep the `.warning` and `.error` haptics for the scanner (UX-08) so they stay meaningful.

### UX-05 · Permanent degradation has worn out the warning (H/M)
**Frames:** every frame's header ("● Unavailable"), Feed / Degraded banner, Feed / First visit (prod).

**Evidence**
- FSIS and CDC have been unavailable since July and FDA press since 2026-10-24 (health audit §1, §7). The red "Unavailable" pill has shown on every screen for 4 months.
- The banner's dismissal is component state, so it comes back on every return to Feed.
- When `fda_rss` broke, the only visible change was three more words in a banner people had stopped reading. The health audit makes the same point for the operator alerts.
- The pill is a `<span>`. It can't be tapped, so "Unavailable" never explains itself.

**Recommendation**
- Separate **chronic** gaps from **new** ones in the UI. A chronic gap shows as calm scope language in the status card (UX-04), not as an alarm.
- A source that newly degrades gets one prominent, dismiss-once notice that persists per source and state.
- The status indicator always opens an explanation.
- The §10 gate stays exactly as it is: no all-clear while anything is degraded. This only changes how the gap is described, not whether it's admitted. It pairs with health-audit T4 (an `acknowledged` flag per source) and depends on T7 (email ingest) to clear for real.

**iOS:** No persistent status pill in the nav bar. Show coverage in the status card and the Sources sheet. A new degradation can use a one-time inline notice. Don't use push for source health: users can't act on it.

---

## Tier 2: what a recall says

### UX-06 · Titles are raw product strings (H/M)
**Frames:** Feed (all), Search / Results "peanut", Recall detail / 320 check, Scanner / Possible match (same company).

**Evidence**
- Card and detail titles render `productDesc` as-is. For example: "a.) nara organics brand; Whole Milk Organic Infant Formula; Milk-based Powder with Iron; 0-12 months; NET WT 24.7 OZ (700 G); UPC: 860013251901 b.)…"
- Cards clamp at 2 lines and often cut mid-phrase ("…Snack Bar; INGREDIENTS:").
- The detail H1 runs about 17 lines at 320pt before the risk level. The baseline crop shows the risk badge at roughly 850pt.
- `line-clamp` is visual only. The live accessibility text of a feed card is the full 250-character string, UPC digits included.
- The adapter's `title` is just the same string cut at 140 characters with "...". The scanner shows that version, so links end mid-word.

**Recommendation**
- Add a **display name** to the data contract: brand plus product, about 60 characters, title case, no UPC, weights or case packs.
- Keep the full description under "Product details" on detail.
- Deriving it is backend work. Heuristics cover the common openFDA shapes (`brand; product; size; UPC`); test it with fixtures in `tests/fixtures/`. An LLM pass is an option if heuristics plateau (open question).
- Never cut text server-side. Let the view truncate.

**iOS:** Card title `.headline`, `lineLimit(2)`. Detail uses `.title2` for the display name, not a large nav title, because product names don't fit a nav bar. Give each card an explicit `accessibilityLabel` built from the display name (see UX-09).

### UX-07 · Detail doesn't say why or what to do (H/M)
**Frames:** Recall detail / Recent (prod), High risk + photo, Bookmarked, UPDATE timeline, Resolved, 320 check; Outbreak detail.

**Evidence**
- `reason_for_recall` ("undeclared sesame", "Listeria monocytogenes", "metal fragments") is the plainest fact in the source. It's used for enrichment but not stored as a field, so no screen shows it. The user gets only the hazard category chip ("Undeclared allergen").
- SPEC §11's recall framing, "Check your kitchen", never appears.
- There's no lot or best-by guidance when `productCodes` is empty, which is about half of recalls (health audit §2), and no company contact.
- The order on detail is: title, company, risk, "Matches your household", who's at risk, allergens, states, codes, timeline, source. So the household reasons sit below a title that can fill the screen.
- The UPDATE timeline shows raw diff text: "classification changed from Class II to Not Yet Classified…".
- On a recent prod recall, "View official source" opens raw api.fda.gov JSON (health audit §1).

**Recommendation.** Reorder detail into the questions a person asks:
1. **What:** display name, photo or glyph, company.
2. **Why:** the reason, in plain words, plus the risk level with its §11 sentence.
3. **Does it affect us:** the household reasons, if matched, near the top.
4. **What to do:** "Check your kitchen" plus the codes to compare (UPC, lot, best-by). If there are none: "This notice lists no barcodes. Compare the brand, size and dates against the notice."
5. **Where:** states.
6. **History:** the timeline, in plain language ("Risk level changed to unknown", "Recall reopened").
7. **Source:** the official notice. Show "Official notice not yet linked" instead of linking to JSON.

Storing `reason` is a small adapter and schema change, with tests.

**iOS:** Push detail onto the Feed's `NavigationStack`, and also present it from a widget or push deep link. Put Share (`ShareLink`) and Save in the toolbar. Make "Check your kitchen" a pinned bottom action, which opens the scanner prefilled to compare UPCs.

### UX-08 · Scanner outcomes are lists, not verdicts (H/M)
**Frames:** Scanner / No known recall, Archived (resolved) recall, Possible match (same company), Match (active recall), 320 check.

**Evidence**
- The same-company outcome is one card listing 10+ links, each cut server-side with "...". The copy reads "…but Chicken of the Sea; Thai Union has another active recall", a raw firm string.
- The pantry row for that can shows 10 identical red "Possible match" pills inside a red border. The outcome card above it has an amber border, so one scan gets two colors.
- An unknown product shows its UPC twice ("121624011625 / 121624011625 · scanned just now").
- A resolved-recall pantry item has no marker.
- UPCs are only extracted from `code_info`, so the exact-UPC rung misses about half of recent recalls (health audit §2). "No known recall" is honest, but it's weaker than the confident layout suggests.
- Camera, permission and busy states were never captured (baseline README).

**Recommendation.** Design four verdict states as one card each: **Recalled**, **Possible (same company)**, **Previously recalled**, **No known recall**.
- Each has one headline, one sentence, at most one or two links, and a "See N other recalls from Thai Union" row instead of a list.
- Pantry rows get one status mark, colored by the worst match's severity (UX-10).
- Keep §11's "No known recall" copy, and add a line on coverage until T3 lands. For example: "Many recall notices don't list barcodes."
- Depends on T3 (UPC from descriptions) and UX-06 (display names).

**iOS:** VisionKit `DataScannerViewController`, with continuous recognition for pantry audits. Results open in a sheet (medium detent) over the live camera, so the next scan is one swipe away. Haptics: `.error` for Recalled, `.warning` for Possible, a light impact for No known recall. Never use `.success` for a scan, because "no known recall" isn't "safe". Keep manual entry. Consider an App Shortcut or Control Center control "Scan a barcode", which suits in-store use.

### UX-09 · Large text and screen readers (H/M)
**Frames:** Feed / 320 check, Recall detail / 320 check, Onboarding 2 / Who, Onboarding 4 / Alerts.

**Evidence (live, dev, 390pt with root text at 200%)**
- The page scrolls sideways (scrollWidth 499 vs 390), which fails WCAG 1.4.4 and 1.4.10. The overflow comes from the card meta row ("41 states", "Unknown area" with `whitespace` and `flex` and no wrap), the hazard chip, and the header's status pill.
- The header grows to 184pt and the banner to 560pt, so the first card starts at 1,630pt, two screens down.
- A card's accessible text is "Jun 18, 2026 · 41 states · [full product string with UPC] · MARS SNACKING · Moderate risk · Foreign material". The risk comes last, after the date.
- The banner is `role=status` `aria-live`, so it's announced again each time Feed mounts.
- From the baseline: the onboarding preset buttons have no accessible name, pet and allergen buttons expose lowercase names, the stepper's only state cue is "(current)", and the nav badge's spoken count (394) differs from what's shown (9+).
- Still open from `docs/wcag-audit.md`: a real VoiceOver pass and dark-mode contrast. There's no dark theme yet (SPEC §12).

Contrast passes where I checked: white on primary chips is 4.52:1 (borderline at 11px), the "Unavailable" pill is 4.72:1, the red impact line is 5.39:1, and white on slate Class III is 4.76:1.

**Recommendation.** Write the card's spoken order down as part of the design: severity, display name, company, household reason, date. Example: "High risk. Riad's Spicy Baba Ghanouj, Oliva on Main. Affects you: sesame allergy. October 9." Draw every screen at the largest accessibility size before calling it done. Card meta rows wrap, and chips stack.

**iOS**
- Use system text styles, so Dynamic Type works through AX5. Custom fonts need `UIFontMetrics` or `.font(.custom(_:size:relativeTo:))`.
- At accessibility sizes, cards switch to a vertical layout: `ViewThatFits`, or `dynamicTypeSize.isAccessibilitySize`.
- Make each card one VoiceOver element: `.accessibilityElement(children: .ignore)` with a composed label, plus a custom action for Save.
- Post the status card's state change as an announcement, not on every appear.
- Ship dark mode from day one (open question). Minimum 44pt targets.

---

## Tier 3: consistency and polish

### UX-10 · The severity-color quarantine is broken (M/S)
**Frames:** every frame (the header pill and the nav badge), Scanner / Match (active recall), Scanner / Possible match, Sign-in / Code error, Household (Delete my account).

**Evidence.** `--color-destructive` (#cc272e) is also `--color-severity-class1`. It's used for:
- the header "Unavailable" pill;
- the nav badge;
- pantry "Possible match" pills and borders;
- the scanner's error text and "Delete my account".

SPEC §12 says severity hues "carry meaning only". A user learns that red means a high-risk recall, then sees red on a count and on a "possible". The UPDATE pill is outlined in `--color-accent-text` #92600a, a brown, not SPEC's amber. That's defensible for contrast, but it's undocumented.

**Recommendation.** Keep two palettes:
- **Severity:** Class I red, Class II amber, Class III slate, Resolved grey, Outbreak orange. It appears only on severity badges, impact lines and verdict cards.
- **System:** for status, counts, errors and destructive actions.

Give "possible" a distinct, lower-urgency treatment, such as an outline in the severity of the underlying recall. Record the `*-text` variants and the UPDATE hue in SPEC §12; the Foundations page lists 8 such divergences.

**iOS:** Native red is the platform's convention for tab badges and destructive buttons. Using the system defaults for those keeps the severity red distinct only if the severity red is visibly a different hue. Decide this explicitly (open question). Severity colors go in the asset catalog under their own namespace.

### UX-11 · Copy leaks internals and raw agency text (M/S)
**Frames:** Household / Full view, Recall detail / UPDATE timeline, Scanner / Possible match (same company), Onboarding 4 / Alerts, Household / Full view vs Onboarding 5 / Review, Feed / Filter.

**Evidence**
- The stores helper ends "(Phase 6, §7)." (`components/HouseholdView.tsx:63`).
- Timeline: "classification changed from Class II to Not Yet Classified". This is bare agency jargon, which §11 bans.
- Raw firm strings with semicolons ("Chicken of the Sea; Thai Union").
- "Recommended alerts · Recommended".
- "1 65+ adult" on Household vs "1 adult 65+" in onboarding. Two generators produce these, and §11 says the summary and rows must agree.
- Allergen casing differs by screen: "crustacean shellfish", "Crustacean Shellfish", "Milk".
- The disclaimer leaves out FDA press releases.
- The detail footer says "Data from openFDA/FSIS". That's jargon, and FSIS isn't the source of an FDA recall.
- The card date "Jun 10, 2026" disagrees with the timeline's "Recall · Jun 10, 2016".

**Recommendation**
- Run a copy pass with one shared formatter per concept: allergen names, age bands, source names, firm names (split on ";" and take the first).
- Every agency term goes through §11's mapping, including timeline summaries, which are generated server-side.
- Agree on a voice sheet for the redesign: calm, plain, "possible" where unconfirmed, never "safe".

**iOS:** Put strings in a String Catalog from the start, even if English-only, so the copy is reviewable in one place.

### UX-12 · Reason chips are inconsistent and sometimes wrong (M/S)
**Frames:** Feed / For your household, Feed / Matched us (See all), Recall detail / 320 check.

**Evidence**
- Risk groups merge into one chip ("65+ risk, Immune risk"). Allergens merge too ("Allergen: milk, peanuts"). State is "Your state".
- "Packed in a facility that handles peanuts" becomes a peanut allergen match.
- Chips vanish in the "Matched us" list, because the feed renders those cards without match data.
- Chain matches use a dashed outline, which no one will read as "possible" without being told.

**Recommendation**
- Use one chip per reason, with the same noun pattern throughout: "Milk allergy", "Peanut allergy", "Infant", "65+", "Weakened immune system", "Publix (possible)", "Your pantry".
- Order chips by tier (UX-03).
- "May contain" and shared-facility mentions get a lower-confidence label, or don't match at all. That's an enrichment change.
- Always render chips when a card matches, in every list.

**iOS:** Chips are a `Layout` flow. At accessibility sizes, collapse them to a single line of text ("Affects you: milk allergy, infant").

### UX-13 · Error and edge states are dead ends (M/S)
**Frames:** Error / Malformed recall id (prod), Unsubscribe / Missing token, Unsubscribe / Invalid token, Invite / Invalid, Offline, Saved / Signed out (empty), Feed / Filter: no results.

**Evidence**
- A malformed ID crashes the whole app, with no navigation (health audit §6; ticket T8).
- The unsubscribe and invite errors are one centered grey line, with no heading or next step.
- The offline page is taller than the viewport.
- Saved, signed out, says "Nothing saved yet. Bookmark a recall…", but signed-out users can't bookmark.
- "Load more" renders under "No recalls match these filters".

**Recommendation.** Every state gets a title, one sentence, and one action: "Back to Feed", "Sign in to save recalls", "Clear filters". A missing recall says "This alert isn't available anymore", not an error.

**iOS:** `ContentUnavailableView` for empty and error states. Deep links that miss land on the Feed with a short toast, not an error screen.

### UX-14 · Onboarding drops answers and skips the alerts step (M/S)
**Frames:** Onboarding 4 / Alerts, Onboarding 5 / Review, Household / Redo setup, Onboarding 2 / Who.

**Evidence**
- SPEC §11 step 4 is preset, plus channel opt-ins, plus the push explainer. The shipped step is presets only, and push is deferred to Household.
- The step 5 review leaves out the favorite stores and the household name.
- Redo setup has no cancel or back on step 1.
- The preset buttons have no accessible name (UX-09).

**Recommendation.** Restore step 4 as SPEC describes. It's the right moment, because the user has just said who they're protecting. The review shows every answer, from the same generator as Household. Redo setup can always be closed.

**iOS:** Onboarding runs as a full-screen cover with its own `NavigationStack`, so Close is always available after first run. Step 4 primes before calling `requestAuthorization`. Consider **provisional authorization** (`.provisional`): it delivers quietly to Notification Center with no prompt, which fits §9's "never fire the prompt cold". Then upgrade to time-sensitive alerts for hard-floor matches.

### UX-15 · The first visit pitches nothing (M/S)
**Frames:** Feed / First visit (prod), Feed / First run (dev).

**Evidence**
- A signed-out first visit shows the "Before you rely on this" disclaimer, then the 4-line coverage banner, then filters. The first card starts at about 480pt.
- Nothing on Feed says the app can match recalls to your household. That pitch only appears on the Scanner and Household tabs.
- The tagline "Recalls that actually apply to you" never appears.

**Recommendation.** Signed out, the status card slot (UX-04) carries the pitch and one action: "Set up your household". Fold the disclaimer into onboarding, plus a permanent "About this data" link, instead of putting it ahead of content.

**iOS:** Decide whether the iOS app can be browsed signed out (open question). If not, the first run is onboarding, and the disclaimer is its first screen.

---

## Tier 4: structure

### UX-16 · Nothing tells you what's new (M/M)
**Frames:** Feed / First visit (prod), Feed / Degraded (dev).

**Evidence**
- The feed sorts by `recallDate`, the recall's initiation date (`convex/recalls.ts` uses the `by_recall_date` index, descending).
- openFDA lags by weeks. So a recall that arrived today, but was initiated a month ago, lands below items you've already seen.
- Prod's top card on 2026-11-11 is dated Oct 9.
- There's no "new since last visit" marker, and no "added" date. `firstSeenAt` exists on every record and isn't shown. Question 1, "is there a new recall?", depends on this.

**Recommendation**
- Group the national feed by when it arrived: "New since you last looked", "This week", "Earlier".
- Show both dates where they differ: "Added Nov 3 · recalled Oct 9".
- "Last looked" can be per device at first.
- Changing sort order touches a paginated query, so it's a backend change with tests.

**iOS:** Store last-seen per device in `@AppStorage`. The tab badge stays as the UX-03 count, not unread items (§12). Pull to refresh. Push deep links open detail, then return to the feed scrolled to "New".

### UX-17 · Feed hierarchy and filtering (M/M)
**Frames:** Feed / For your household, Feed / Matched us (See all), Feed / Filter: state = NC, Feed / Filter: no results, Feed / 320 check.

**Evidence**
- The pinned section shows 8 full cards, about 1,450pt. The national feed starts around 1,730pt, two screens down.
- The filter bar is four native selects plus "Matched us". They wrap to ragged rows at 390, and none of them shows a count.
- A matched card in the national feed doesn't show that it matched. Chips only appear in the pinned section, which goes against "badge, never bury".

**Recommendation**
- Show the top 2–3 tier-1 matches as full cards inside the status card (UX-04). Everything else lives in the feed, where matched items keep their chips wherever they appear.
- Replace the selects with one Filter control that opens a sheet. Show active filters as removable tokens.

**iOS:** Feed gets a segmented scope control: "For you" and "All". Search moves into the Feed's nav bar with `.searchable`, which removes the header search icon. Filters open in a sheet with detents and a Reset button. That matches the Holy Grails precedent (DESIGN-AUDIT A10).

### UX-18 · The visual system has drifted (M/M)
**Frames:** Foundations (the specimen sheet and its 8 divergences), all of them.

**Evidence**
- Radii in the JSX: `rounded-full` ×68, `--radius-base` ×15, `rounded-lg` ×14, `rounded-xl` ×3, `rounded-md` ×1, `rounded-2xl` ×1.
- Weights: Bold ×51, Semibold ×27, Medium ×18, Black ×13, Normal ×1. SPEC §12 says Regular for UI and body.
- Arbitrary sizes: `text-[11px]` ×5, `text-[10px]` ×1.
- Seventeen text styles in all, against what is really a five-style app.
- Pills are everywhere: risk, hazard, chips, buttons and filters all use the same full-round shape, so nothing reads as more important.

**Recommendation.** A minimal scale for the redesign:
- **Radii:** 3 values (small for chips and tags, medium for cards, full only for buttons).
- **Type:** about 6 roles mapped to iOS text styles: large title, title, headline, body, subheadline, caption.
- **Weights:** Regular body, Semibold emphasis, Bold or Black only for the wordmark and section titles, as SPEC intends.

Give buttons, tags and chips three distinct shapes, so a severity badge never looks like a filter.

**iOS:** Use the system text styles, which bring Dynamic Type with them. Public Sans is optional (open question). If it stays, register it and scale it with `relativeTo:`. Corner radii use `.continuous` style.

### UX-19 · Household is one long settings scroll (M/M)
**Frames:** Household / Full view (1,884pt), Invite pending, Push denied + delete confirm, Digest only preset, 320 check (2,016pt).

**Evidence**
- One page holds: the summary; location; stores (with a spec reference); allergens; members; pets; category toggles; brands and keywords; notifications with an inline push explainer; members and invites; and account actions including Delete.
- The category toggles carry a strong consequence ("silences it completely — even urgent alerts") as small helper text.

**Recommendation**
- Lead with the §11 summary sentence, tappable to edit.
- Group the rest into drill-ins: Who we protect (members, pets, allergens), Where and what we buy (states, stores, brands), Alerts (preset, channels, categories), and People and account.
- Ask for confirmation, with a clear consequence, before turning a category off.

**iOS:** A grouped `Form` with `NavigationLink` rows, in the style of the Settings app. Delete account sits at the bottom with `.confirmationDialog`. Notification settings deep-link to the system settings when push is denied (`UIApplication.openNotificationSettingsURLString`), which recovers §9's "nearly unrecoverable" denied state.

### UX-20 · Search ranks old resolved recalls first (L/S)
**Frames:** Search / Results "peanut", Search / No results.

**Evidence.** Most "peanut" hits are 2012–2021 resolved recalls, sorted by date only. Digit search misses UPCs that are only in descriptions (health audit §2).

**Recommendation.** Rank active matches first, then resolved under an "Older recalls" header. Treat digit-only queries as a UPC lookup with the scanner's normalization.

**iOS:** `.searchable` with scopes ("Active", "All"). Search suggestions come from the household's brands and allergens.

---

## Design principles for the redesign

1. **Answer the three questions before showing a list.** The first thing on screen says whether anything affects the household and how sure we are. Lists come second.
2. **One number, one meaning.** The badge, the widget, the section header and the digest all show the same active, household-specific count.
3. **Earn the silence, and describe gaps as scope.** No all-clear while any source is behind (§10, unchanged). Describe the gap as what's missing, calmly, rather than as a red alarm that never turns off.
4. **Severity color means severity.** Status, counts, errors and "possible" use other colors.
5. **Write for people, not agencies.** Display names, the recall reason, what to do, plain-language history. Never "safe".
6. **Every outcome is designed.** Scanner verdicts, empty states, errors, missing links, permission states, and the largest text size.
7. **Native by default.** Tab bar, `NavigationStack`, sheets with detents, `.searchable`, system text styles, VoiceOver labels composed on purpose, and haptics only where they carry meaning.

## Open questions for Shawn

1. **What counts as a match?** Should "sold in your state" (state-only and nationwide) still count toward the badge and the household section, or move to its own tier (UX-03)? Should it still notify? That one touches SPEC §9.
2. **Copy for chronic gaps.** Is it acceptable for the UI to describe FSIS/CDC as a known, ongoing gap ("missing since July") instead of an alarm, with the §10 gate unchanged (UX-05)?
3. **Display names.** Heuristics only, or allow an LLM pass at ingest for products the heuristics can't parse (UX-06)? The LLM pass has a cost and a new dependency.
4. **Typeface.** Keep Public Sans on iOS, or use SF Pro with Public Sans only for the wordmark (UX-18)?
5. **Red on iOS chrome.** Use the system red for the tab badge and destructive actions, or a non-severity hue (UX-10)?
6. **Signed-out use.** Can the iOS app be browsed before setup, or is onboarding required (UX-15)?
7. **Dark mode in iOS v1?** SPEC §12 says light-only for the web v1. iOS users expect dark mode, and the WCAG doc still has dark contrast open.
8. **The web app until iOS ships.** Should UX-01, UX-02, UX-10, UX-11 and UX-13 go to quick web tickets now? Each is small, and UX-02 is a one-line CSS fix.
9. **Scanner placement.** Keep Scanner as a tab, or move it to a toolbar button plus an App Shortcut or Control Center control, and give the tab to something else (UX-08)?

## Related tickets from the health audit

The UX depends on these landing:
- **T3** (UPC from descriptions): UX-08 and UX-20.
- **T5/T6** (press relay, match window): photos, UX-02.
- **T7** (email ingest for FSIS/CDC): clearing UX-05 for real.
- **T4** (alerting and acknowledgement): UX-05.
- **T8** (error boundaries): UX-13.
- **T12** (copy nits): folded into UX-11.
