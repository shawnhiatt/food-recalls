"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RecallCard } from "@/components/RecallCard";
import { FilterBar, type FeedFilters } from "@/components/FilterBar";
import { SourceHealthBanner } from "@/components/SourceHealthBanner";
import { EmptyState } from "@/components/EmptyState";
import { CardListSkeleton } from "@/components/CardListSkeleton";
import { DisclaimerFooter, FirstRunNotice } from "@/components/Disclaimer";

// Feed (SPEC.md §8): one national feed, reverse-chronological, filter chips.
// The "For your household" boosted section and reason chips arrive with the
// Phase 2 matcher — out of scope here.
export default function FeedPage() {
  const [filters, setFilters] = useState<FeedFilters>({});
  const { results, status, loadMore } = usePaginatedQuery(
    api.recalls.list,
    { filters },
    { initialNumItems: 20 },
  );

  const hasActiveFilters = Boolean(
    filters.state || filters.audience || filters.hazardType || filters.allergen,
  );

  return (
    <main>
      <FirstRunNotice />
      <SourceHealthBanner />
      <FilterBar filters={filters} onChange={setFilters} />

      {status === "LoadingFirstPage" ? (
        <CardListSkeleton />
      ) : results.length === 0 ? (
        <EmptyState variant={hasActiveFilters ? "no-results" : "no-data"} />
      ) : (
        <ul className="flex flex-col gap-3 px-4 pb-4">
          {results.map((recall) => (
            <li key={recall._id}>
              <RecallCard recall={recall} />
            </li>
          ))}
        </ul>
      )}

      {status === "CanLoadMore" && (
        <div className="px-4 pb-6">
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
        <p className="px-4 pb-6 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          Loading…
        </p>
      )}
      <DisclaimerFooter />
    </main>
  );
}
