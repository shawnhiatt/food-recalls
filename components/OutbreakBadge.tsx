import { OUTBREAK_STATUS_LABEL, type OutbreakStatus } from "@/lib/copy";

// Outbreak analogue of RiskLevelBadge (SPEC.md §12): outbreaks get their own
// solid deep-orange "Be aware" treatment — distinguishable from Class I red
// at a glance, matching the "be aware" vs "check your kitchen" framing (§11).
// Resolved falls back to the same neutral gray recalls use once closed.
export function OutbreakBadge({
  status,
  className = "",
}: {
  status: OutbreakStatus;
  className?: string;
}) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${className}`}
      style={{
        background: active ? "var(--color-severity-outbreak)" : "var(--color-severity-resolved)",
        color: active ? "#ffffff" : "var(--color-foreground)",
      }}
    >
      {OUTBREAK_STATUS_LABEL[status]}
    </span>
  );
}
