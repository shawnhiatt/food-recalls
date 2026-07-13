"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RecallCard } from "@/components/RecallCard";
import { OutbreakCard } from "@/components/OutbreakCard";
import { CardListSkeleton } from "@/components/CardListSkeleton";

// Saved tab (SPEC.md §12): bookmarked alerts, "check the freezer when I get
// home" / shopping-trip use.
export default function SavedPage() {
  const bookmarks = useQuery(api.bookmarks.list);

  return (
    <main>
      <h1 className="px-4 pb-2 pt-2 text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
        Saved
      </h1>

      {bookmarks === undefined ? (
        <CardListSkeleton count={3} />
      ) : bookmarks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "var(--color-secondary)" }}
            aria-hidden="true"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round">
              <path d="M6 3h12v18l-6-4.5L6 21V3z" />
            </svg>
          </div>
          <p className="max-w-xs text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            Nothing saved yet. Bookmark a recall from its detail page to find it here later.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3 px-4 pb-4">
          {bookmarks.map((entry) => (
            <li key={entry._id}>
              {entry.alertType === "outbreak" ? (
                <OutbreakCard outbreak={entry} />
              ) : (
                <RecallCard recall={entry} />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
