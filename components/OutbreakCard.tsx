import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { OutbreakImage } from "@/components/OutbreakImage";
import { OutbreakBadge } from "@/components/OutbreakBadge";
import { ReasonChips } from "@/components/ReasonChips";
import { formatDate, formatGeography, formatImpactLine } from "@/lib/format";
import type { OutbreakStatus, MatchDimension } from "@/lib/copy";

// Outbreak card anatomy (SPEC.md §12), the outbreak counterpart to
// RecallCard: image/placeholder, date, geography, pathogen + suspected food
// as the headline, "Be aware" badge instead of a risk level (outbreaks have
// no FDA classification), and the red impact line ("12 sick · 4
// hospitalized") this app's recalls don't carry data for yet. Reason chips
// (§8, Phase 6) are optional: only the "For your household" section passes
// match data.
export type OutbreakCardData = {
  _id: Id<"outbreaks">;
  publishedAt: string;
  states: string[];
  pathogen: string;
  suspectedFood?: string;
  title: string;
  status: OutbreakStatus;
  caseCount?: number;
  hospitalizations?: number;
  updateHistory: unknown[];
  imageUrl?: string;
};

export function OutbreakCard({
  outbreak,
  matchedOn,
  matchedDetails,
}: {
  outbreak: OutbreakCardData;
  matchedOn?: MatchDimension[];
  matchedDetails?: Partial<Record<MatchDimension, string[]>>;
}) {
  const hasUpdates = outbreak.updateHistory.length > 1;
  const impactLine = formatImpactLine(outbreak.caseCount, outbreak.hospitalizations);
  const headline = outbreak.suspectedFood ?? outbreak.title;

  return (
    <Link
      href={`/outbreaks/${outbreak._id}`}
      className="flex gap-3 rounded-(--radius-base) p-3 active:opacity-80"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
    >
      <OutbreakImage imageUrl={outbreak.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-(--radius-base)" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          <span>{formatDate(outbreak.publishedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatGeography(outbreak.states)}</span>
          {hasUpdates && (
            <span
              className="ml-auto rounded-full border px-2 py-0.5 text-[11px] font-bold"
              style={{ borderColor: "var(--color-accent-text)", color: "var(--color-accent-text)" }}
            >
              UPDATE
            </span>
          )}
        </div>
        <h3 className="mt-1 line-clamp-2 text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
          {headline}
        </h3>
        <p className="truncate text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          {outbreak.pathogen} outbreak
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <OutbreakBadge status={outbreak.status} />
          {impactLine && (
            <span className="text-xs font-medium" style={{ color: "var(--color-destructive)" }}>
              {impactLine}
            </span>
          )}
        </div>
        {matchedOn && matchedOn.length > 0 && (
          <ReasonChips matchedOn={matchedOn} matchedDetails={matchedDetails ?? {}} className="mt-2" />
        )}
      </div>
    </Link>
  );
}
