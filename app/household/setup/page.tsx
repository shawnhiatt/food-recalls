"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  OnboardingWizard,
  toQuestionnaire,
  defaultAnswers,
  type WizardAnswers,
} from "@/components/OnboardingWizard";
import type { AgeBand } from "@/lib/copy";

// "Redo setup" (SPEC.md §11: re-runnable anytime, prefilled with current
// answers). Reuses the onboarding wizard, seeded from the stored preferences,
// and saves via redoSetup (owner-only).
export default function RedoSetupPage() {
  const router = useRouter();
  const prefs = useQuery(api.household.getMyPreferences, {});
  const settings = useQuery(api.household.getMyNotificationSettings, {});
  const redo = useMutation(api.household.redoSetup);

  if (prefs === undefined || settings === undefined) {
    return <Centered>Loading…</Centered>;
  }
  if (prefs === null) {
    return <Centered>No household to edit.</Centered>;
  }

  const base = defaultAnswers();
  const initial: WizardAnswers = {
    householdName: prefs.householdName,
    location: { states: prefs.states, stores: prefs.chains },
    people: {
      members: prefs.members.map((m) => ({
        ageBand: m.ageBand as AgeBand,
        pregnant: m.pregnant,
        immunocompromised: m.immunocompromised,
        customLabel: m.labelPinned ? m.label : undefined,
      })),
      pets: prefs.pets,
    },
    allergens: prefs.allergens,
    notifications: {
      preset: settings?.preset ?? "recommended",
      timezone: base.notifications.timezone,
    },
    brands: prefs.brands,
    keywords: prefs.keywords,
  };

  async function handleSubmit(answers: WizardAnswers) {
    await redo({ answers: toQuestionnaire(answers) });
    router.replace("/household");
  }

  return <OnboardingWizard initial={initial} submitLabel="Save changes" onSubmit={handleSubmit} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
      {children}
    </p>
  );
}
