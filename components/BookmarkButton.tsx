"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function BookmarkButton({
  alertId,
  alertType = "recall",
}: {
  alertId: Id<"recalls"> | Id<"outbreaks">;
  alertType?: "recall" | "outbreak";
}) {
  const bookmarked = useQuery(api.bookmarks.isBookmarked, { alertId });
  const toggle = useMutation(api.bookmarks.toggle);

  return (
    <button
      type="button"
      onClick={() => void toggle({ alertId, alertType })}
      aria-pressed={bookmarked ?? false}
      aria-label={bookmarked ? "Remove bookmark" : `Save this ${alertType}`}
      className="flex h-11 w-11 items-center justify-center rounded-full active:opacity-70"
      style={{ background: "var(--color-secondary)" }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill={bookmarked ? "var(--color-primary)" : "none"}
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 3h12v18l-6-4.5L6 21V3z" />
      </svg>
    </button>
  );
}
