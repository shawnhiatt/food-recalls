import type { HazardType } from "@/lib/copy";

// Fallback rung 3 of the photo strategy (SPEC.md §3): a category illustration
// on a soft tint keyed to hazard type, shown whenever no press/OpenFoodFacts
// image is available — which is every card until the FDA RSS/press ingest
// follow-up lands.
const ICON: Record<HazardType, (fg: string) => React.ReactNode> = {
  microbial: (fg) => (
    <>
      <circle cx="8" cy="9" r="1.6" fill={fg} />
      <circle cx="15" cy="7" r="1.2" fill={fg} />
      <circle cx="16" cy="15" r="1.6" fill={fg} />
      <circle cx="9" cy="16" r="1.1" fill={fg} />
      <circle cx="12" cy="12" r="2.2" fill={fg} />
    </>
  ),
  allergen: (fg) => (
    <path
      d="M12 3l2.2 5.6L20 10l-4.6 3.6L16.8 20 12 16.5 7.2 20l1.4-6.4L4 10l5.8-1.4L12 3z"
      fill={fg}
    />
  ),
  foreign_material: (fg) => (
    <>
      <rect x="5" y="5" width="6" height="6" rx="1" fill={fg} />
      <circle cx="16" cy="16" r="3.2" fill={fg} />
      <rect x="13" y="4" width="5" height="5" rx="1" transform="rotate(20 15.5 6.5)" fill={fg} />
    </>
  ),
  other: (fg) => (
    <path
      d="M12 4a8 8 0 100 16 8 8 0 000-16zm0 4v4.5l3 2"
      fill="none"
      stroke={fg}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

export function ImagePlaceholder({
  hazardType,
  className = "",
}: {
  hazardType: HazardType;
  className?: string;
}) {
  const tint = `var(--color-hazard-${hazardType}-tint)`;
  const fg = `var(--color-hazard-${hazardType}-fg)`;

  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{ background: tint }}
      aria-hidden="true"
    >
      <svg width="40%" height="40%" viewBox="0 0 24 24" style={{ maxWidth: 64, maxHeight: 64 }}>
        {ICON[hazardType](fg)}
      </svg>
    </div>
  );
}
