import { classifyRiskLevel, RISK_LEVEL_LABEL, type RiskLevel } from "@/lib/copy";

// Severity color system (SPEC.md §12): quarantined from the brand palette —
// never reuse --color-primary/--color-accent here. Resolved (any non-active
// lifecycle) always overrides the classification color with neutral gray,
// since urgency no longer applies once a recall is closed out.
const COLOR: Record<RiskLevel | "resolved", string> = {
  high: "var(--color-severity-class1)",
  moderate: "var(--color-severity-class2)",
  low: "var(--color-severity-class3)",
  unknown: "var(--color-severity-class3)",
  resolved: "var(--color-severity-resolved)",
};

// White text fails WCAG AA on the lighter severity fills (amber ~1.8:1, grey
// ~2.5:1, measured) — dark foreground text is required there instead.
const TEXT_COLOR: Record<RiskLevel | "resolved", string> = {
  high: "#ffffff",
  moderate: "var(--color-foreground)",
  low: "#ffffff",
  unknown: "#ffffff",
  resolved: "var(--color-foreground)",
};

export function RiskLevelBadge({
  classification,
  lifecycle,
  className = "",
}: {
  classification: string;
  lifecycle: "active" | "completed" | "terminated" | "withdrawn" | "corrected";
  className?: string;
}) {
  const resolved = lifecycle !== "active";
  const level = classifyRiskLevel(classification);
  const label = resolved ? "Resolved" : RISK_LEVEL_LABEL[level];
  const key = resolved ? "resolved" : level;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${className}`}
      style={{ background: COLOR[key], color: TEXT_COLOR[key] }}
    >
      {label}
    </span>
  );
}
