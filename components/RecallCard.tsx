import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { RecallImage } from "@/components/RecallImage";
import { RiskLevelBadge } from "@/components/RiskLevelBadge";
import { ReasonChips } from "@/components/ReasonChips";
import { formatDate, formatGeography } from "@/lib/format";
import { HAZARD_TYPE_LABEL, type HazardType, type MatchDimension } from "@/lib/copy";

// Card anatomy (SPEC.md §12), scoped to what Phase 1 data actually has:
// product photo/placeholder, date, geography badge, product name, company,
// hazard line + icon, plain-language risk level, UPDATE badge. "Retailer
// when known" needs Phase 6 chain matching text extraction, not built — not
// rendered rather than faked. Reason chips (§8, Phase 6) are optional: only
// the "For your household" section passes match data.
export type RecallCardData = {
  _id: Id<"recalls">;
  recallDate: string;
  states: string[];
  productDesc: string;
  firm: string;
  hazardType: HazardType;
  classification: string;
  lifecycle: "active" | "completed" | "terminated" | "withdrawn" | "corrected";
  updateHistory: unknown[];
  imageUrl?: string;
};

export function RecallCard({
  recall,
  matchedOn,
  matchedDetails,
}: {
  recall: RecallCardData;
  matchedOn?: MatchDimension[];
  matchedDetails?: Partial<Record<MatchDimension, string[]>>;
}) {
  const hasUpdates = recall.updateHistory.length > 1;

  return (
    <Link
      href={`/recalls/${recall._id}`}
      className="flex gap-3 rounded-(--radius-base) p-3 active:opacity-80"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
    >
      {/* Decorative on cards: the product name renders right beside it. */}
      <RecallImage
        imageUrl={recall.imageUrl}
        hazardType={recall.hazardType}
        alt=""
        className="h-20 w-20 shrink-0 rounded-(--radius-base)"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          <span>{formatDate(recall.recallDate)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatGeography(recall.states)}</span>
          {hasUpdates && (
            <span
              className="ml-auto rounded-full border px-2 py-0.5 text-[11px] font-bold"
              style={{ borderColor: "var(--color-accent-text)", color: "var(--color-accent-text)" }}
            >
              UPDATE
            </span>
          )}
        </div>
        <h3
          className="mt-1 line-clamp-2 text-sm font-bold"
          style={{ color: "var(--color-foreground)" }}
        >
          {recall.productDesc}
        </h3>
        <p className="truncate text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          {recall.firm}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RiskLevelBadge classification={recall.classification} lifecycle={recall.lifecycle} />
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
          >
            {HAZARD_TYPE_LABEL[recall.hazardType]}
          </span>
        </div>
        {matchedOn && matchedOn.length > 0 && (
          <ReasonChips matchedOn={matchedOn} matchedDetails={matchedDetails ?? {}} className="mt-2" />
        )}
      </div>
    </Link>
  );
}
