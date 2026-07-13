"use client";

import { useState } from "react";

// Outbreak analogue of RecallImage (SPEC.md §3 photo strategy). Outbreak
// records rarely carry a usable image (§3 "outbreak records are thin"), so
// this leans on the placeholder far more often than RecallImage does — a
// fixed deep-orange tint (not hazard-type-keyed, since outbreaks have none)
// keeps it visually distinct from any recall card at a glance.
export function OutbreakImage({
  imageUrl,
  alt,
  className = "",
  priority = false,
}: {
  imageUrl?: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ background: "var(--color-hazard-outbreak-tint)" }}
        aria-hidden="true"
      >
        <svg width="40%" height="40%" viewBox="0 0 24 24" style={{ maxWidth: 64, maxHeight: 64 }}>
          <circle cx="8" cy="9" r="1.6" fill="var(--color-hazard-outbreak-fg)" />
          <circle cx="15" cy="7" r="1.2" fill="var(--color-hazard-outbreak-fg)" />
          <circle cx="16" cy="15" r="1.6" fill="var(--color-hazard-outbreak-fg)" />
          <circle cx="9" cy="16" r="1.1" fill="var(--color-hazard-outbreak-fg)" />
          <circle cx="12" cy="12" r="2.2" fill="var(--color-hazard-outbreak-fg)" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: "var(--color-hazard-outbreak-tint)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external CDC
          image URLs on an unpredictable host, same rationale as RecallImage. */}
      <img
        src={imageUrl}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
