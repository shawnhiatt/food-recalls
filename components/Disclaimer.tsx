"use client";

import { useEffect, useState } from "react";

// Disclaimers (SPEC.md §12): "footer + first-run: data from openFDA/FSIS/CDC,
// unvalidated, not an official alerting service."

const FIRST_RUN_KEY = "food-recalls:first-run-ack";

const DISCLAIMER_TEXT =
  "Data comes from openFDA, USDA FSIS, and CDC. openFDA states its data is " +
  "unvalidated; this app is not an official alerting service. Always verify " +
  "against the linked official notice.";

/**
 * One-time first-run disclosure, shown until acknowledged. Renders nothing
 * during SSR/first paint (localStorage is client-only), so there's no
 * hydration mismatch and no flash for returning users.
 */
export function FirstRunNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(FIRST_RUN_KEY)) setVisible(true);
    } catch {
      // Storage unavailable (private mode): fall back to the footer only
      // rather than showing an undismissable notice every visit.
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(FIRST_RUN_KEY, String(Date.now()));
    } catch {
      // Best effort; the footer disclaimer still shows every visit.
    }
  };

  return (
    <div
      role="note"
      className="mx-4 mt-3 rounded-(--radius-base) px-3 py-2.5 text-sm"
      style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
    >
      <p className="font-bold">Before you rely on this</p>
      <p className="mt-1">{DISCLAIMER_TEXT}</p>
      <button
        type="button"
        onClick={dismiss}
        className="mt-2 min-h-11 rounded-full px-4 text-sm font-bold text-white"
        style={{ background: "var(--color-primary)" }}
      >
        Got it
      </button>
    </div>
  );
}

/** Persistent footer variant — small, muted, always present at the feed's end. */
export function DisclaimerFooter() {
  return (
    <footer className="px-6 pb-6 pt-2 text-center text-xs" style={{ color: "var(--color-muted-foreground)" }}>
      {DISCLAIMER_TEXT}
    </footer>
  );
}
