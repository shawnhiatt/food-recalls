import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  AGE_BAND_LABEL,
  PRESET_LABEL,
  formatAllergenLabel,
  type AgeBand,
} from "@/lib/copy";

// Household tab (SPEC.md §12 nav item 4): read-only recap of the seeded
// preferences (§11 Step 5) + notification settings view. A Server Component
// so PILOT_ACCESS_SECRET (§2) stays server-only and never reaches the
// client bundle — unlike the Feed/Detail/Saved screens, this one can't be a
// live-reactive Client Component. Editable in Phase 5 ("Redo setup").
//
// force-dynamic: without it, `next build` statically prerenders this page and
// the summary freezes at deploy time — a re-seed would never show up.
export const dynamic = "force-dynamic";

export default async function HouseholdPage() {
  const secret = process.env.PILOT_ACCESS_SECRET;
  if (!secret) {
    return (
      <Message>
        PILOT_ACCESS_SECRET isn&apos;t set for this deployment. Set it via{" "}
        <code>npx convex env set PILOT_ACCESS_SECRET &lt;value&gt;</code> and mirror the same
        value into <code>.env.local</code> as <code>PILOT_ACCESS_SECRET</code> (server-only,
        never <code>NEXT_PUBLIC_</code>).
      </Message>
    );
  }

  const summary = await fetchQuery(api.household.getPilotSummary, { secret });
  if (!summary) {
    return <Message>No household has been seeded yet. Run the Phase 0 seed script.</Message>;
  }

  return (
    <main className="px-4 py-4">
      <h1 className="text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
        {summary.householdName}
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        {summary.summary}
      </p>

      <Section title="Location">
        <p className="text-sm" style={{ color: "var(--color-foreground)" }}>
          {summary.states.length > 0 ? summary.states.join(", ") : "No state set"}
        </p>
      </Section>

      {summary.allergens.length > 0 && (
        <Section title="Allergens">
          <ul className="flex flex-wrap gap-1.5">
            {summary.allergens.map((allergen) => (
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

      <Section title="Household members">
        <ul className="flex flex-col gap-1.5">
          {summary.members.map((member, i) => (
            <li key={i} className="text-sm" style={{ color: "var(--color-foreground)" }}>
              {member.label}
              {/* Unpinned labels already *are* the age-band name ("Adult",
                  "Kid") — only show it separately once a manual rename (§11
                  "derive, then pin") makes it non-redundant information. */}
              {member.labelPinned && ` · ${AGE_BAND_LABEL[member.ageBand as AgeBand]}`}
              {member.pregnant && " · Pregnant"}
              {member.immunocompromised && " · Weakened immune system"}
            </li>
          ))}
        </ul>
      </Section>

      {summary.pets.length > 0 && (
        <Section title="Pets">
          <p className="text-sm capitalize" style={{ color: "var(--color-foreground)" }}>
            {summary.pets.join(", ")}
          </p>
        </Section>
      )}

      <Section title="Notifications">
        <p className="text-sm" style={{ color: "var(--color-foreground)" }}>
          {PRESET_LABEL[summary.preset]}
        </p>
      </Section>

      <p className="mt-8 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
        Household settings are read-only for now — editing arrives with accounts in Phase 5.
      </p>
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

function Message({ children }: { children: React.ReactNode }) {
  return (
    <main className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
      {children}
    </main>
  );
}
