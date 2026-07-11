"use client";

import { useEffect, useState } from "react";

// Web Share API with a pre-written message + deep link (SPEC.md §12).
// Feature-detected (pwa skill rule 2): falls back to copy-to-clipboard
// rather than disappearing on browsers without navigator.share.
export function ShareButton({ title }: { title: string }) {
  const [mode, setMode] = useState<"share" | "copy" | "none">("none");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    // `typeof navigator.share === "function"`, not `"share" in navigator`:
    // the DOM lib types `share` as always-present, so the `in` operator
    // narrows the else-branch to `never` and breaks the clipboard fallback.
    if (typeof navigator.share === "function") setMode("share");
    else if (navigator.clipboard) setMode("copy");
  }, []);

  if (mode === "none") return null;

  const handleClick = async () => {
    const url = window.location.href;
    if (mode === "share") {
      try {
        await navigator.share({
          title,
          text: "Just saw this recall — worth double-checking",
          url,
        });
      } catch {
        // User cancelled the share sheet — not an error.
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      aria-label={mode === "share" ? "Share this recall" : copied ? "Link copied" : "Copy link"}
      className="flex h-11 w-11 items-center justify-center rounded-full active:opacity-70"
      style={{ background: "var(--color-secondary)" }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
    </button>
  );
}
