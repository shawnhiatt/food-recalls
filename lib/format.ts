/** "8 states" / "Nationwide" / "NC" — the feed card's geography badge. */
export function formatGeography(states: string[]): string {
  if (states.length === 0) return "Unknown area";
  if (states.includes("US")) return "Nationwide";
  if (states.length === 1) return states[0]!;
  return `${states.length} states`;
}

/** "2026-06-01" -> "Jun 1, 2026". Falls back to the raw string if unparseable. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, y, m, d] = match.map(Number) as unknown as [never, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "12 sick" / "12 sick · 4 hospitalized" — the card's red impact line (SPEC.md §12), outbreaks only. */
export function formatImpactLine(caseCount?: number, hospitalizations?: number): string | null {
  if (!caseCount) return null;
  const sick = `${caseCount} sick`;
  return hospitalizations ? `${sick} · ${hospitalizations} hospitalized` : sick;
}

/** "2 hours ago" / "3 days ago" — used by the source-health status pill. */
export function formatRelativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
