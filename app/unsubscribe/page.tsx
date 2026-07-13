"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// One-click email unsubscribe (SPEC.md §2). Reached from a token link in every
// email footer; no login required. Shows which address it affects, then one
// click stops the emails. Push and in-app alerts are untouched.
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <UnsubscribeInner />
    </Suspense>
  );
}

function UnsubscribeInner() {
  const token = useSearchParams().get("token") ?? "";
  const preview = useQuery(api.unsubscribe.preview, token ? { token } : "skip");
  const unsubscribe = useMutation(api.unsubscribe.unsubscribe);
  const [done, setDone] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);

  if (!token) return <Centered>Missing unsubscribe token.</Centered>;
  if (preview === undefined) return <Centered>Loading…</Centered>;
  if (preview === null) return <Centered>This unsubscribe link isn&apos;t valid.</Centered>;

  async function handle() {
    setBusy(true);
    const result = await unsubscribe({ token });
    setDone(result.email ?? "your address");
    setBusy(false);
  }

  if (done || preview.alreadyUnsubscribed) {
    return (
      <main className="px-6 py-16 text-center">
        <h1 className="text-2xl font-black" style={{ color: "var(--color-foreground)" }}>You&apos;re unsubscribed</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          {done ?? preview.email} won&apos;t receive recall emails anymore. You can turn them back
          on anytime from your Household tab.
        </p>
      </main>
    );
  }

  return (
    <main className="px-6 py-16 text-center">
      <h1 className="text-2xl font-black" style={{ color: "var(--color-foreground)" }}>Unsubscribe from emails</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        Stop sending recall emails to{" "}
        <strong style={{ color: "var(--color-foreground)" }}>{preview.email}</strong>? Push and
        in-app alerts stay on.
      </p>
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        className="mt-6 min-h-[44px] rounded-full px-6 py-3 text-sm font-bold text-white disabled:opacity-60"
        style={{ background: "var(--color-destructive)" }}
      >
        {busy ? "Unsubscribing…" : "Unsubscribe"}
      </button>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
      {children}
    </p>
  );
}
