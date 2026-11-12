# CLAUDE.md — Food Recalls

Read at the start of every session. `SPEC.md` is authoritative for product behavior, the data contract and the copy rules. `TODO.md` is the backlog. `HANDOFF.md` says where the last session stopped. Shawn is a senior designer, comfortable with React and the web and newer to Swift: explain iOS concepts briefly as they come up.

## What this is

A household food-safety monitor. Convex ingests federal recall and outbreak data (openFDA, USDA FSIS, FDA press RSS, CDC), enriches it (allergens, audience, hazard type, states), and matches it against a household's state, brands, allergens, risk groups, pets and stores. The app shows a "boost and badge, never bury" feed, sends instant and digest email plus web push, and has a barcode scanner with a pantry. It is a Next.js PWA on Vercel. All 8 SPEC phases have shipped (last commit 2026-07-19).

**The core contract (SPEC §10):** the app may only reassure ("you're all clear") when every enabled source is current. A degraded source switches the copy to explicit incompleteness. Never weaken this.

## Where things live

- Prod web: https://food-recalls-nu.vercel.app (Vercel). Prod Convex: `good-lynx-479`. The dev deployment's name is in `.env.local` once `npx convex dev` has run (not committed).
- Crons only register where `ENABLE_CRONS` is set (prod only), and Convex reads it at **deploy** time (`convex/crons.ts`).
- `convex/adapters/` holds pure per-source normalization, the project's center of gravity, tested with recorded fixtures in `tests/fixtures/`.
- `convex/lib/` holds pure logic: matching (§7), the decision matrix (§9), digest, push payloads (lock-screen redaction is enforced by the function signature), and auth (per-household authorization).
- `app/` holds the routes (Feed, Scanner, Saved, Household, detail pages, search, onboarding, sign-in). `components/` holds the shared UI.

## Build and test

```bash
npm ci
npm test            # vitest + convex-test, no deployment needed
npm run typecheck   # convex, app and service-worker tsconfigs
npm run lint
npm run build
npm run dev         # Convex dev (needs `npx convex` login + .env.local)
npm run dev:web     # Next.js on :3000 (.claude/launch.json "web")
```

## Working agreement

1. **Read before writing.** Match the existing patterns. SPEC §17 decisions are settled; changing one gets logged in SPEC (iOS reverses §17.1, "PWA, not native").
2. **One concern per session.** This repo's "(main)" session coordinates and spins off ticket sessions (worktrees on `claude/<ticket>` branches).
3. **Ask before committing, pushing, deploying, setting env vars, or touching prod** (`--prod`, `good-lynx-479`, Vercel).
4. **Never guess secrets.** Env values come from Shawn or the Convex/Vercel dashboards.
5. **Every backend change gets tests**, in the style of `tests/*.test.ts`.
6. **Copy follows SPEC §11:** calm and plain. "No known recall," never "safe." Possible matches say "possible."
7. **Severity colors are quarantined** from the brand palette (SPEC §12).
8. **Prod Convex deploys only from `main`, after it is pushed.** Never `npx convex deploy` from a ticket worktree: two ticket deploys on 2026-11-12 overwrote each other. Merge first, then deploy.

## Design

- Figma baseline of the current PWA (2026-11-11): https://www.figma.com/design/XyJxXlBeqLsJFmPeoC68Qm. Pages: Foundations (SPEC §12 tokens as variables, the Public Sans ramp as used, code-vs-SPEC divergences), Baseline (60 frames at 390 and 320, grouped by flow), Annotations (observations for the UX audit). It shows what shipped. Don't edit it to match a redesign; put the redesign in a new file or new pages.
- Figma iOS redesign (2026-11-12): https://www.figma.com/design/wh0GKJHOwveL6RmZp8nL2v ("Food Recalls iOS"). Pages: Cover, Foundations (Light/Dark variables, severity quarantine, SF Pro / Dynamic Type styles, SF Symbols, SPEC §12 divergences), Components, Screens (53 frames, light and dark), Native extras (widgets, notifications, share sheet), Decisions (decisions tied to UX-NN, open questions, backend implications). Text is drawn in Inter as an SF Pro stand-in, because the MCP renderer can't measure SF Pro.
- Dev test accounts used for captures are listed at the bottom of `.env.example`.

## Known upstream blocks

FSIS and CDC answer HTTP 403 to non-browser clients (TLS-fingerprint bot detection, since 2026-07). Still true on 2026-11-11. `sourceHealth` reports them as unavailable, so the app never shows all-clear copy. See TODO "Data-source reliability."

## iOS

Planned as a native SwiftUI view layer over this same Convex backend, modeled on `~/Documents/projects/holy-grails-ios`. See `HANDOFF.md` for status. Backend changes the iOS app needs land in this repo, with tests, in their own session.
