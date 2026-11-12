"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { StatusMessage } from "@/components/StatusMessage";

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

  // UX-13: a broken link still gets a way to manage email from the app.
  if (!token || preview === null) {
    return (
      <main>
        <StatusMessage
          icon="link"
          title="This unsubscribe link doesn't work"
          body={
            token
              ? "It may be out of date. You can turn off recall emails from the Household tab instead."
              : "The link looks incomplete. You can turn off recall emails from the Household tab instead."
          }
          action={{ label: "Go to Household", href: "/household" }}
        />
      </main>
    );
  }
  if (preview === undefined) return <Centered>Loading…</Centered>;

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
        style={{ background: "var(--color-status-error)" }}
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
