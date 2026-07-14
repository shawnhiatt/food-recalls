"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RecallCard, type RecallCardData } from "@/components/RecallCard";
import { OutbreakCard, type OutbreakCardData } from "@/components/OutbreakCard";
import { EmptyState } from "@/components/EmptyState";
import { CardListSkeleton } from "@/components/CardListSkeleton";

// Search (SPEC.md §10): text search over recalls + outbreaks that deliberately
// spans ARCHIVED alerts the default feed hides — the one place, besides a
// direct link or a scanner UPC check, that a resolved or older recall stays
// reachable. Public government data, so no auth gate (same posture as the feed).
export default function SearchPage() {
  const [query, setQuery] = useState("");
  const term = query.trim();
  const active = term.length > 0;

  const { results, status, loadMore } = usePaginatedQuery(
    api.recalls.search,
    active ? { query: term } : "skip",
    { initialNumItems: 20 },
  );
  const outbreaks = useQuery(api.outbreaks.search, active ? { query: term } : "skip");

  // Interleave the paginated recall hits with the small outbreak result set by
  // date, newest first — same approach the feed uses (see app/page.tsx).
  const merged = useMemo(() => {
    type Entry =
      | { kind: "recall"; date: string; recall: RecallCardData }
      | { kind: "outbreak"; date: string; outbreak: OutbreakCardData };
    const entries: Entry[] = [
      ...results.map((r): Entry => ({ kind: "recall", date: r.recallDate, recall: r })),
      ...(outbreaks ?? []).map((o): Entry => ({ kind: "outbreak", date: o.publishedAt, outbreak: o })),
    ];
    return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [results, outbreaks]);

  // Wait for both streams before declaring "no results", so a slower outbreak
  // query can't flash an empty state while recall hits are still loading.
  const loadingFirst = active && (status === "LoadingFirstPage" || outbreaks === undefined);

  return (
    <main className="px-4 py-4">
      <h1 className="text-xl font-black" style={{ color: "var(--color-foreground)" }}>
        Search
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        Search all recalls and outbreaks by product, brand, company, or barcode — including
        older ones that have dropped off the feed.
      </p>

      <div className="mt-4">
        <label htmlFor="search-q" className="sr-only">
          Search recalls and outbreaks
        </label>
        <input
          id="search-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- search is the sole purpose of this screen
          autoFocus
          placeholder="e.g. peanut butter, Publix, 012345678905"
          className="w-full rounded-lg border px-3 py-2.5 text-base"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-background)",
            color: "var(--color-foreground)",
          }}
        />
      </div>

      {!active ? (
        <p className="mt-10 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          Start typing to search recalls and outbreaks.
        </p>
      ) : loadingFirst ? (
        <div className="mt-4">
          <CardListSkeleton />
        </div>
      ) : merged.length === 0 ? (
        <div className="mt-4">
          <EmptyState variant="no-search-results" />
        </div>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-3 pb-4">
            {merged.map((entry) =>
              entry.kind === "outbreak" ? (
                <li key={`outbreak-${entry.outbreak._id}`}>
                  <OutbreakCard outbreak={entry.outbreak} />
                </li>
              ) : (
                <li key={`recall-${entry.recall._id}`}>
                  <RecallCard recall={entry.recall} />
                </li>
              ),
            )}
          </ul>
          {status === "CanLoadMore" && (
            <div className="pb-6">
              <button
                type="button"
                onClick={() => loadMore(20)}
                className="w-full rounded-full py-2.5 text-sm font-bold"
                style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
              >
                Load more
              </button>
            </div>
          )}
          {status === "LoadingMore" && (
            <p className="pb-6 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              Loading…
            </p>
          )}
        </>
      )}
    </main>
  );
}
