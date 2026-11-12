"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatRelativeTime } from "@/lib/format";

/**
 * Reassurance gate (SPEC.md §10): "nothing here" copy is only permitted to
 * read as reassuring when every enabled source is Current — and all-clear
 * copy carries the last-checked timestamp (§12) so the reassurance is
 * provable, not asserted. When a source is degraded, the copy switches to
 * explicit incompleteness — never implying "all clear" on data we can't
 * vouch for.
 */
export function EmptyState({
  variant,
  action,
}: {
  variant: "no-results" | "no-data" | "no-household-matches" | "no-search-results";
  /** UX-13: the one way forward (clear filters, clear search). */
  action?: { label: string; onClick: () => void };
}) {
  const status = useQuery(api.sourceHealth.getPublicStatus);
  const degraded = Boolean(status && !status.allCurrent);

  // Oldest last-success across sources — the most conservative honest claim.
  const oldestSuccess =
    status && status.allCurrent
      ? Math.min(...status.sources.map((s) => s.lastSuccessAt))
      : null;

  // Titles never reassure: "nothing matches" is a fact about the query, not
  // a safety claim. All-clear wording stays gated on every source Current.
  const title =
    variant === "no-household-matches"
      ? "Nothing matches your household right now"
      : variant === "no-search-results"
      ? "No results"
      : variant === "no-results"
      ? "No recalls match these filters"
      : degraded
        ? "Coverage incomplete"
        : "No recalls right now";

  const body =
    variant === "no-household-matches"
      ? "That's not the same as “all clear” on the full feed. Clear this filter to see everything."
      : variant === "no-search-results"
      ? "Try fewer or different words — a product, brand, company, or barcode — or check the spelling."
      : variant === "no-results"
      ? "Try clearing one or two."
      : degraded
        ? "We can't confirm the feed is fully up to date yet. Nothing here should be read as “all clear.”"
        : `No recalls in our records right now. We'll show them here the moment a source reports one.${
            oldestSuccess ? ` Sources last checked ${formatRelativeTime(oldestSuccess)}.` : ""
          }`;

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--color-secondary)" }}
        aria-hidden="true"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16v4H4z" />
          <path d="M4 12h16" />
          <path d="M4 16h10" />
          <path d="M4 20h7" />
        </svg>
      </div>
      <h2 className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>
        {title}
      </h2>
      <p className="max-w-xs text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        {body}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-white"
          style={{ background: "var(--color-primary)" }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
