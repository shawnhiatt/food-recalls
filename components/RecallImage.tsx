"use client";

import { useState } from "react";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import type { HazardType } from "@/lib/copy";

// Photo strategy (SPEC.md §3): press/Open Food Facts image when resolved,
// hazard-tinted category illustration otherwise. Real press photography is
// inconsistent (odd aspect ratios, photographed labels), so the image sits
// object-contain inside the same tinted container the placeholder uses —
// never stretched or cropped to illegibility. Press-release image URLs can
// also rot (§15), so a load error falls back to the placeholder at runtime.
export function RecallImage({
  imageUrl,
  hazardType,
  alt,
  className = "",
  priority = false,
}: {
  imageUrl?: string;
  hazardType: HazardType;
  alt: string;
  className?: string;
  /** Eager-load — for the detail hero (the page's LCP element); cards stay lazy. */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return <ImagePlaceholder hazardType={hazardType} className={className} />;
  }

  return (
    <div
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: `var(--color-hazard-${hazardType}-tint)` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external press/OFF
          URLs on arbitrary hosts; next/image would need a domain allowlist we
          can't predict, and the feed already lazy-loads. */}
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
