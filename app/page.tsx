"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RecallCard, type RecallCardData } from "@/components/RecallCard";
import { OutbreakCard, type OutbreakCardData } from "@/components/OutbreakCard";
import { FilterBar, type FeedFilters } from "@/components/FilterBar";
import { SourceHealthBanner } from "@/components/SourceHealthBanner";
import { EmptyState } from "@/components/EmptyState";
import { CardListSkeleton } from "@/components/CardListSkeleton";
import { DisclaimerFooter, FirstRunNotice } from "@/components/Disclaimer";
import { HouseholdMatchSection } from "@/components/HouseholdMatchSection";

// Feed (SPEC.md §8): one national feed, reverse-chronological, filter chips,
// plus the "For your household" boosted section (Phase 6). Phase 4 adds CDC
// outbreaks into the same feed with "be aware" framing (§3, §11).
export default function FeedPage() {
  const [filters, setFilters] = useState<FeedFilters>({});
  const { results, status, loadMore } = usePaginatedQuery(
    api.recalls.list,
    { filters },
    { initialNumItems: 20 },
  );
  const outbreaks = useQuery(api.outbreaks.list, {});
  const context = useQuery(api.household.getMyContext, {});
  const myMatches = useQuery(api.feed.myMatches, filters.matchedOnly ? {} : "skip");
  const matchedIds = useMemo(
    () =>
      myMatches
        ? new Set(myMatches.map((m) => (m.alertType === "recall" ? m.recall._id : m.outbreak._id)))
        : null,
    [myMatches],
  );

  const hasActiveFilters = Boolean(
    filters.state || filters.audience || filters.hazardType || filters.allergen || filters.matchedOnly,
  );

  // Outbreaks carry no audience/hazardType/allergen fields, so a filter on
  // any of those dimensions has nothing to say about them — hide rather than
  // guess. The state filter does apply (outbreaks have states).
  const outbreaksApplicable = !filters.audience && !filters.hazardType && !filters.allergen;
  const filteredOutbreaks = useMemo(() => {
    if (!outbreaks || !outbreaksApplicable) return [];
    if (!filters.state) return outbreaks;
    return outbreaks.filter((o) => o.states.includes(filters.state!) || o.states.includes("US"));
  }, [outbreaks, outbreaksApplicable, filters.state]);

  // Interleave the paginated recall stream with the small, fully-reactive
  // outbreak list by date — outbreaks are always recent (§3: CDC only lists
  // current investigations), so they naturally settle near the top of a
  // reverse-chronological feed without needing cross-table pagination.
  const merged = useMemo(() => {
    type Entry =
      | { kind: "recall"; date: string; recall: RecallCardData }
      | { kind: "outbreak"; date: string; outbreak: OutbreakCardData };
    const entries: Entry[] = [
      ...results.map((r): Entry => ({ kind: "recall", date: r.recallDate, recall: r })),
      ...filteredOutbreaks.map((o): Entry => ({ kind: "outbreak", date: o.publishedAt, outbreak: o })),
    ];
    const sorted = entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (!filters.matchedOnly || !matchedIds) return sorted;
    return sorted.filter((e) =>
      matchedIds.has(e.kind === "recall" ? e.recall._id : e.outbreak._id),
    );
  }, [results, filteredOutbreaks, filters.matchedOnly, matchedIds]);

  const isLoading =
    status === "LoadingFirstPage" || (filters.matchedOnly && myMatches === undefined);

  return (
    <main>
      <FirstRunNotice />
      <SourceHealthBanner />
      {!filters.matchedOnly && <HouseholdMatchSection />}
      <FilterBar filters={filters} onChange={setFilters} showMatchedFilter={context?.hasHousehold ?? false} />

      {isLoading ? (
        <CardListSkeleton />
      ) : merged.length === 0 ? (
        <EmptyState
          variant={filters.matchedOnly ? "no-household-matches" : hasActiveFilters ? "no-results" : "no-data"}
        />
      ) : (
        <ul className="flex flex-col gap-3 px-4 pb-4">
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
