"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Reassurance gate (SPEC.md §10): "nothing here" copy is only permitted to
 * read as reassuring when every enabled source is Current. When a source is
 * degraded, the copy switches to explicit incompleteness — never implying
 * "all clear" on data we can't vouch for.
 */
export function EmptyState({ variant }: { variant: "no-results" | "no-data" }) {
  const status = useQuery(api.sourceHealth.getPublicStatus);

  const body =
    variant === "no-results"
      ? "No recalls match these filters. Try clearing one or two."
      : status && !status.allCurrent
        ? "Coverage incomplete — we can't confirm the feed is fully up to date yet. Nothing here should be read as “all clear.”"
        : "No recalls in our records right now. We'll show them here the moment a source reports one.";

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
      <p className="max-w-xs text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        {body}
      </p>
    </div>
  );
}
