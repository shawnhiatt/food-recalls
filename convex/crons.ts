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

export default crons;
