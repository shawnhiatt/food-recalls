"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Invite acceptance (SPEC.md §2). The invitee must sign in with the invited
// email (verified by OTP) before they can accept — enforced server-side in
// acceptInvite; the UI mirrors it.
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const invite = useQuery(api.invites.getByToken, { token });
  const accept = useMutation(api.invites.acceptInvite);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (invite === undefined || isLoading) return <Centered>Loading…</Centered>;
  if (invite === null || invite.status !== "pending") {
    return <Centered>This invite isn&apos;t valid anymore. Ask for a new one.</Centered>;
  }

  async function handleAccept() {
    setBusy(true);
    setError(null);
    try {
      await accept({ token });
      router.replace("/household");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't accept this invite.");
      setBusy(false);
    }
  }

  return (
    <main className="px-6 py-12 text-center">
      <h1 className="text-2xl font-black" style={{ color: "var(--color-foreground)" }}>
        Join {invite.householdName}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        You were invited as a {invite.role}. Sign in with{" "}
        <strong style={{ color: "var(--color-foreground)" }}>{invite.email}</strong> to accept.
      </p>

      {isAuthenticated ? (
        <button
          type="button"
          onClick={handleAccept}
          disabled={busy}
          className="mt-6 min-h-[44px] rounded-full px-6 py-3 text-sm font-bold text-white disabled:opacity-60"
          style={{ background: "var(--color-primary)" }}
        >
          {busy ? "Joining…" : "Accept invite"}
        </button>
      ) : (
        <Link
          href="/signin"
          className="mt-6 inline-block min-h-[44px] rounded-full px-6 py-3 text-sm font-bold text-white"
          style={{ background: "var(--color-primary)" }}
        >
          Sign in to accept
        </Link>
      )}
      {error && <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-destructive)" }}>{error}</p>}
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
