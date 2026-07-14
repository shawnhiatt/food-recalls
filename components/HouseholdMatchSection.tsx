"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RecallCard } from "@/components/RecallCard";
import { OutbreakCard } from "@/components/OutbreakCard";

// §8: "'For your household' pinned section at the top: matched alerts,
// ranked by severity, then match confidence, then recency." Ranking already
// happens server-side (convex/feed.ts myMatches); this renders the top of
// it. Capped rather than exhaustive: a broad state-only match (e.g. every
// nationwide recall) can rank into the hundreds for a real household, and a
// "pinned section" that long stops boosting anything — it just duplicates
// the feed. The rest stays one tap away via "See all" (the "Matched us"
// filter, which shows the same ranked set, uncapped). Nothing here means
// nothing to boost — the section disappears rather than showing an empty
// box, since "boost and badge, never bury" only calls for elevating
// matches, not announcing their absence (the national feed below already
// covers "nothing missed").
const VISIBLE_LIMIT = 8;

export function HouseholdMatchSection({ onSeeAll }: { onSeeAll?: () => void }) {
  const matches = useQuery(api.feed.myMatches, {});

  if (!matches || matches.length === 0) return null;
  const visible = matches.slice(0, VISIBLE_LIMIT);
  const remaining = matches.length - visible.length;

  return (
    <section aria-label="For your household" className="px-4 pb-2 pt-3">
      <h2 className="mb-2 text-sm font-black" style={{ color: "var(--color-foreground)" }}>
        For your household
      </h2>
      <ul className="flex flex-col gap-3">
        {visible.map((entry) =>
          entry.alertType === "outbreak" ? (
            <li key={`outbreak-${entry.outbreak._id}`}>
              <OutbreakCard
                outbreak={entry.outbreak}
                matchedOn={entry.matchedOn}
                matchedDetails={entry.matchedDetails}
              />
            </li>
          ) : (
            <li key={`recall-${entry.recall._id}`}>
              <RecallCard
                recall={entry.recall}
                matchedOn={entry.matchedOn}
                matchedDetails={entry.matchedDetails}
              />
            </li>
          ),
        )}
      </ul>
      {remaining > 0 && onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-2 w-full rounded-full py-2 text-xs font-bold"
          style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
        >
          See all {matches.length} matches
        </button>
      )}
    </section>
  );
}
