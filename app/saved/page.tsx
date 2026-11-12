"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RecallCard } from "@/components/RecallCard";
import { OutbreakCard } from "@/components/OutbreakCard";
import { CardListSkeleton } from "@/components/CardListSkeleton";
import { StatusMessage } from "@/components/StatusMessage";

// Saved tab (SPEC.md §12): bookmarked alerts, "check the freezer when I get
// home" / shopping-trip use.
export default function SavedPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const bookmarks = useQuery(api.bookmarks.list);

  return (
    <main>
      <h1 className="px-4 pb-2 pt-2 text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
        Saved
      </h1>

      {/* UX-13: signed out, there's nothing to bookmark with, so say so. */}
      {!isLoading && !isAuthenticated ? (
        <StatusMessage
          icon="bookmark"
          headingLevel="h2"
          title="Save recalls for later"
          body="Sign in to bookmark recalls and find them here, like a list to check when you get home."
          action={{ label: "Sign in", href: "/signin" }}
        />
      ) : bookmarks === undefined ? (
        <CardListSkeleton count={3} />
      ) : bookmarks.length === 0 ? (
        <StatusMessage
          icon="bookmark"
          headingLevel="h2"
          title="Nothing saved yet"
          body="Tap the bookmark on any recall to keep it here."
          action={{ label: "Browse recalls", href: "/" }}
        />
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
