"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OutbreakImage } from "@/components/OutbreakImage";
import { OutbreakBadge } from "@/components/OutbreakBadge";
import { Timeline } from "@/components/Timeline";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ShareButton } from "@/components/ShareButton";
import { formatDate, formatGeography, formatImpactLine } from "@/lib/format";
import { OUTBREAK_STATUS_DESCRIPTION, RISK_GROUP_LABEL, type RiskGroup } from "@/lib/copy";

// Outbreak detail view (SPEC.md §12, Phase 4): the outbreak counterpart to
// RecallDetail. No allergens or product-code sections — outbreak records
// carry neither (§7 "outbreak records are thin"). "Be aware" framing
// throughout per §11.
export function OutbreakDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const outbreak = useQuery(api.outbreaks.get, { id: params.id as Id<"outbreaks"> });

  if (outbreak === undefined) return <DetailSkeleton />;
  if (outbreak === null) {
    return (
      <main className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <p style={{ color: "var(--color-muted-foreground)" }}>This outbreak couldn&apos;t be found.</p>
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

  const impactLine = formatImpactLine(outbreak.caseCount, outbreak.hospitalizations);
  const headline = outbreak.suspectedFood ?? outbreak.title;

  return (
    <main className="pb-6">
      <OutbreakImage
        imageUrl={outbreak.imageUrl}
        alt={`Illustration for the ${outbreak.pathogen} outbreak`}
        className="h-48 w-full"
        priority
      />

      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          <span>{formatDate(outbreak.publishedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatGeography(outbreak.states)}</span>
        </div>

        <div className="mt-2 flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
            {headline}
          </h1>
          <div className="flex shrink-0 gap-2">
            <BookmarkButton alertId={outbreak._id} alertType="outbreak" />
            <ShareButton title={outbreak.title} />
          </div>
        </div>
        <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          {outbreak.pathogen} outbreak
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OutbreakBadge status={outbreak.status} />
          {impactLine && (
            <span className="text-xs font-bold" style={{ color: "var(--color-destructive)" }}>
              {impactLine}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          {OUTBREAK_STATUS_DESCRIPTION[outbreak.status]}
        </p>

        {outbreak.riskGroups.length > 0 && (
          <Section title="Who's at risk?">
            <ul className="flex flex-wrap gap-1.5">
              {outbreak.riskGroups.map((group) => (
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

        <Section title="Affected states">
          <p className="text-sm" style={{ color: "var(--color-foreground)" }}>
            {outbreak.states.length === 0
              ? "Not specified by CDC yet"
              : outbreak.states.includes("US")
                ? "Nationwide"
                : outbreak.states.join(", ")}
          </p>
        </Section>

        <Section title="Timeline">
          <Timeline entries={outbreak.updateHistory} />
        </Section>

        <a
          href={outbreak.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex items-center justify-center rounded-full py-3 text-sm font-bold text-white"
          style={{ background: "var(--color-primary)" }}
        >
          View official source
        </a>
        <p className="mt-3 text-center text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          Data from CDC, unvalidated. Not an official alerting service — always verify against the
          linked investigation page.
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
