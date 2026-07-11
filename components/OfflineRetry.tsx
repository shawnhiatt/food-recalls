"use client";

import { useEffect } from "react";

// Custom offline fallback (pwa skill, tech.md): a real retry button, plus an
// `online` listener so reconnecting auto-reloads without the user noticing.
export function OfflineRetry() {
  useEffect(() => {
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-2 rounded-full px-5 py-2.5 text-sm font-bold text-white"
      style={{ background: "var(--color-primary)" }}
    >
      Retry
    </button>
  );
}
