"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";

// Passwordless email sign-in (SPEC.md §5/§17.7). Two steps: enter your email to
// receive a one-time code, then enter the code. Email is verified by the act of
// receiving the code, which is what satisfies the §2 "email verification" gate.
export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("resend-otp", { email: email.trim().toLowerCase() });
      setStep("code");
    } catch {
      setError("Couldn't send a code to that address. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("resend-otp", { email: email.trim().toLowerCase(), code: code.trim() });
      // Household screen decides whether to send the user into onboarding.
      router.replace("/household");
    } catch {
      setError("That code didn't match or has expired. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 py-10">
      <div
        className="mx-auto max-w-sm rounded-2xl border p-6"
        style={{ background: "var(--color-card)", borderColor: "var(--color-border)" }}
      >
        <h1 className="text-2xl font-black" style={{ color: "var(--color-foreground)" }}>
          Sign in
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          Recalls that actually apply to you. We&apos;ll email you a sign-in code — no password.
        </p>

        {step === "email" ? (
          <form onSubmit={sendCode} className="mt-5 flex flex-col gap-3">
            <label className="text-sm font-semibold" htmlFor="email" style={{ color: "var(--color-foreground)" }}>
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-lg border px-3 py-2.5 text-base"
              style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
            />
            <SubmitButton busy={busy}>{busy ? "Sending…" : "Email me a code"}</SubmitButton>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-5 flex flex-col gap-3">
            <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              We sent a code to <strong style={{ color: "var(--color-foreground)" }}>{email}</strong>.
            </p>
            <label className="text-sm font-semibold" htmlFor="code" style={{ color: "var(--color-foreground)" }}>
              Sign-in code
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="8-digit code"
              className="rounded-lg border px-3 py-2.5 text-base tracking-widest"
              style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
            />
            <SubmitButton busy={busy}>{busy ? "Verifying…" : "Verify & sign in"}</SubmitButton>
            <button
              type="button"
              onClick={() => { setStep("email"); setCode(""); setError(null); }}
              className="text-xs font-semibold underline"
              style={{ color: "var(--color-primary-text)" }}
            >
              Use a different email
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-destructive)" }}>
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-1 min-h-[44px] rounded-full px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
      style={{ background: "var(--color-primary)" }}
    >
      {children}
    </button>
  );
}
