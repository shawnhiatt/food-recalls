"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HouseholdView } from "@/components/HouseholdView";

// Household tab (SPEC.md §12 nav 4). Phase 5: fully editable, gated by Convex
// Auth. Branches on the caller's context — signed out, signed in without a
// household (needs onboarding), or an established household.
export default function HouseholdPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const context = useQuery(api.household.getMyContext, {});

  if (isLoading || context === undefined) {
    return <Centered>Loading…</Centered>;
  }

  if (!isAuthenticated || !context.signedIn) {
    return (
      <Prompt
        title="Your household, your alerts"
        body="Sign in to set up the recalls that actually apply to you — your state, brands, allergens, and who's at home."
        cta="Sign in"
        href="/signin"
      />
    );
  }

  if (context.needsOnboarding) {
    return (
      <Prompt
        title="Finish setting up"
        body="Tell us where you are and who's in your household so we can match recalls to you. Takes about two minutes."
        cta="Start setup"
        href="/onboarding"
      />
    );
  }

  return <HouseholdView />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
      {children}
    </p>
  );
}

function Prompt({ title, body, cta, href }: { title: string; body: string; cta: string; href: string }) {
  return (
    <main className="px-6 py-16 text-center">
      <h1 className="text-2xl font-black" style={{ color: "var(--color-foreground)" }}>{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--color-muted-foreground)" }}>{body}</p>
      <Link
        href={href}
        className="mt-6 inline-block min-h-[44px] rounded-full px-6 py-3 text-sm font-bold text-white"
        style={{ background: "var(--color-primary)" }}
      >
        {cta}
      </Link>
    </main>
  );
}
