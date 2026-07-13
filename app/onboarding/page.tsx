"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OnboardingWizard, toQuestionnaire, type WizardAnswers } from "@/components/OnboardingWizard";

// First-run onboarding (SPEC.md §11, §13 Phase 5). Signed-in users with no
// household land here; on submit we create their household + owner member.
export default function OnboardingPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const context = useQuery(api.household.getMyContext, isAuthenticated ? {} : "skip");
  const complete = useMutation(api.household.completeOnboarding);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/signin");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (context?.hasHousehold) router.replace("/household");
  }, [context, router]);

  if (isLoading || !isAuthenticated || context === undefined) {
    return <Centered>Loading…</Centered>;
  }
  if (context.hasHousehold) return <Centered>Redirecting…</Centered>;

  async function handleSubmit(answers: WizardAnswers) {
    await complete({ answers: toQuestionnaire(answers) });
    router.replace("/household");
  }

  return <OnboardingWizard submitLabel="Finish setup" onSubmit={handleSubmit} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
      {children}
    </p>
  );
}
