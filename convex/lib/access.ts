import { ConvexError } from "convex/values";

// Pilot access gate (SPEC.md §2): household preferences must never be
// reachable through an unauthenticated public query, even with no auth
// system yet. `getPilotSummary` checks the caller-supplied secret against
// this env var, set once via `npx convex env set PILOT_ACCESS_SECRET <value>`
// and mirrored into the Next.js server's `.env.local` (never NEXT_PUBLIC_*,
// so it never reaches the browser bundle). Replaced by real per-household
// authorization in Phase 5.
export function requirePilotSecret(secret: string): void {
  const expected = process.env.PILOT_ACCESS_SECRET;
  if (!expected) {
    throw new ConvexError(
      "PILOT_ACCESS_SECRET is not set on this deployment; refusing to serve household data.",
    );
  }
  if (secret !== expected) {
    throw new ConvexError("unauthorized");
  }
}
