"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { coverageGapLines, type SourceCode } from "@/lib/copy";

type SourceStatus = { source: SourceCode; state: "current" | "delayed" | "unavailable"; lastSuccessAt: number };

// Text uses the darker *-text variants (WCAG AA against --color-secondary);
// the dot is decorative and can stay at full brand/severity saturation.
const STATUS_TEXT_COLOR: Record<SourceStatus["state"], string> = {
  current: "var(--color-primary-text)",
  delayed: "var(--color-accent-text)",
  unavailable: "var(--color-destructive)",
};

const STATUS_DOT_COLOR: Record<SourceStatus["state"], string> = {
  current: "var(--color-primary)",
  delayed: "var(--color-accent)",
  unavailable: "var(--color-destructive)",
};

const STATUS_LABEL: Record<SourceStatus["state"], string> = {
  current: "Current",
  delayed: "Delayed",
  unavailable: "Unavailable",
};

/** §10: worst state across sources wins ("Unavailable" beats "Delayed" beats "Current"). */
function worstState(sources: SourceStatus[]): SourceStatus["state"] {
  if (sources.some((s) => s.state === "unavailable")) return "unavailable";
  if (sources.some((s) => s.state === "delayed")) return "delayed";
  return "current";
}

/** Always-visible status indicator (§10) — mobile header placement. */
export function SourceStatusPill() {
  const status = useQuery(api.sourceHealth.getPublicStatus);
  if (!status || status.sources.length === 0) return null;

  const state = worstState(status.sources);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
      style={{ background: "var(--color-secondary)", color: STATUS_TEXT_COLOR[state] }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_DOT_COLOR[state] }} aria-hidden="true" />
      {STATUS_LABEL[state]}
    </span>
  );
}

/**
 * Persistent, dismissible banner (§10) — shown only while a source is
 * degraded. Reassurance copy ("you're all clear") is never generated here;
 * that's the empty state's job, gated on `allCurrent` (see EmptyState).
 *
 * Two separate claims (UX-01): coverage (which sources are behind, since
 * when) always; "no matches" only when a household really has zero matches,
 * and never when signed out — there's nothing to match against.
 */
export function SourceHealthBanner() {
  const status = useQuery(api.sourceHealth.getPublicStatus);
  const matches = useQuery(api.feed.myMatches, {});
  const [dismissed, setDismissed] = useState(false);

  if (!status || status.allCurrent || dismissed) return null;
  const gaps = coverageGapLines(status.sources, Date.now());

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 mt-3 flex items-start gap-3 rounded-(--radius-base) px-3 py-2.5 text-sm"
      style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
    >
      <div className="flex-1">
        <p>
          <strong>Coverage incomplete.</strong> {gaps.join(" ")}
        </p>
        {matches?.length === 0 && <p className="mt-1">No matches for your household in the data we have.</p>}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        &times;
      </button>
    </div>
  );
}
