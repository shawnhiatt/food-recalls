import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Scheduled ingest (SPEC.md §4). Failures self-heal on the next scheduled run;
// sourceHealth tracks degradation and gates reassurance copy (§10).
// Phase 1 adds FDA RSS/press ingest; Phase 4 adds CDC outbreak pages.

const crons = cronJobs();

// openFDA publishes weekly; a daily pull keeps the "current" window tight
// without hammering the API.
crons.daily(
  "openFDA food enforcement ingest",
  { hourUTC: 9, minuteUTC: 15 },
  internal.ingest.openfda.ingestRecent,
  {},
);

// FSIS is near real-time (§3: every 2–4h).
crons.interval("FSIS recall ingest", { hours: 3 }, internal.ingest.fsis.ingest, {});

// FDA press releases (§3: every 2–4h) — photos, risk-group text, and real
// notice URLs enriching the enforcement records; plus the Open Food Facts
// image fallback.
crons.interval(
  "FDA press release ingest",
  { hours: 3 },
  internal.ingest.fdaRss.ingest,
  {},
);

// CDC outbreak investigations (§3/§4: every 2–4h, Phase 4). Re-fetches every
// current foodborne investigation each run — see convex/ingest/cdc.ts header
// for why that's the right cadence for this source.
crons.interval("CDC outbreak ingest", { hours: 3 }, internal.ingest.cdc.ingest, {});

// Daily email digests (§9). Runs hourly and sends to each member whose local
// hour matches their digestHour; empty digests still send (the trust mechanism),
// with copy gated by source health (§10).
crons.hourly(
  "send daily email digests",
  { minuteUTC: 0 },
  internal.notifications.sendDigests,
  {},
);

export default crons;
