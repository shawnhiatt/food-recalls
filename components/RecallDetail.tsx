"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { RiskLevelBadge } from "@/components/RiskLevelBadge";
import { Timeline } from "@/components/Timeline";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ShareButton } from "@/components/ShareButton";
import { formatDate, formatGeography } from "@/lib/format";
import {
  classifyRiskLevel,
  HAZARD_TYPE_LABEL,
  RISK_GROUP_LABEL,
  RISK_LEVEL_DESCRIPTION,
  formatAllergenLabel,
  type RiskGroup,
} from "@/lib/copy";

// Detail view (SPEC.md §12): photo, summary, "Who's at risk?", affected
// states, product list with codes, Timeline, company info, bookmark + share,
// prominent official-source link. Split out from app/recalls/[id]/page.tsx
// so that file can stay a Server Component and export generateMetadata
// (Client Components can't export page metadata).
export function RecallDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const recall = useQuery(api.recalls.get, { id: params.id as Id<"recalls"> });

  if (recall === undefined) return <DetailSkeleton />;
  if (recall === null) {
    return (
      <main className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <p style={{ color: "var(--color-muted-foreground)" }}>This recall couldn&apos;t be found.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-sm font-bold"
          style={{ color: "var(--color-primary-text)" }}
        >
          Back to Feed
        </button>
      </main>
    );
  }

  const level = classifyRiskLevel(recall.classification);
  const resolved = recall.lifecycle !== "active";

  return (
    <main className="pb-6">
      <ImagePlaceholder hazardType={recall.hazardType} className="h-48 w-full" />

      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          <span>{formatDate(recall.recallDate)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatGeography(recall.states)}</span>
        </div>

        <div className="mt-2 flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
            {recall.productDesc}
          </h1>
          <div className="flex shrink-0 gap-2">
            <BookmarkButton alertId={recall._id} />
            <ShareButton title={recall.productDesc} />
          </div>
        </div>
        <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          Company: {recall.firm}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RiskLevelBadge classification={recall.classification} lifecycle={recall.lifecycle} />
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
          >
            {HAZARD_TYPE_LABEL[recall.hazardType]}
          </span>
        </div>
        {!resolved && (
          <p className="mt-2 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            {RISK_LEVEL_DESCRIPTION[level]}
          </p>
        )}

        {recall.riskGroups.length > 0 && (
          <Section title="Who's at risk?">
            <ul className="flex flex-wrap gap-1.5">
              {recall.riskGroups.map((group) => (
                <li
                  key={group}
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
                >
                  {RISK_GROUP_LABEL[group as RiskGroup] ?? group}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {recall.allergens.length > 0 && (
          <Section title="Allergens">
            <ul className="flex flex-wrap gap-1.5">
              {recall.allergens.map((allergen) => (
                <li
                  key={allergen}
                  className="rounded-full px-2.5 py-1 text-xs font-medium capitalize"
                  style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
                >
                  {formatAllergenLabel(allergen)}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Affected states">
          <p className="text-sm" style={{ color: "var(--color-foreground)" }}>
            {recall.states.includes("US") ? "Nationwide" : recall.states.join(", ")}
          </p>
        </Section>

        {recall.productCodes.length > 0 && (
          <Section title="Product codes">
            <ul className="flex flex-wrap gap-1.5">
              {recall.productCodes.map((code) => (
                <li
                  key={code}
                  className="rounded-(--radius-base) px-2 py-1 font-mono text-xs"
                  style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
                >
                  {code}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Timeline">
          <Timeline entries={recall.updateHistory} />
        </Section>

        <a
          href={recall.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex items-center justify-center rounded-full py-3 text-sm font-bold text-white"
          style={{ background: "var(--color-primary)" }}
        >
          View official source
        </a>
        <p className="mt-3 text-center text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          Data from openFDA/FSIS, unvalidated. Not an official alerting service — always verify
          against the linked notice.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <main className="animate-pulse pb-6" aria-hidden="true">
      <div className="h-48 w-full" style={{ background: "var(--color-secondary)" }} />
      <div className="space-y-3 px-4 pt-4">
        <div className="h-3 w-1/3 rounded" style={{ background: "var(--color-secondary)" }} />
        <div className="h-6 w-full rounded" style={{ background: "var(--color-secondary)" }} />
        <div className="h-4 w-1/2 rounded" style={{ background: "var(--color-secondary)" }} />
      </div>
    </main>
  );
}
