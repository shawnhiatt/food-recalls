import { formatDate } from "@/lib/format";

type UpdateHistoryEntry = {
  date: string;
  label: string;
  summary: string;
  contentHash: string;
};

// Vertical timeline (SPEC.md §12): Recall → Update 1 → Update 2, rendered
// straight from updateHistory.
export function Timeline({ entries }: { entries: UpdateHistoryEntry[] }) {
  return (
    <ol className="relative">
      {entries.map((entry, i) => (
        <li key={entry.contentHash + i} className="relative flex gap-3 pb-6 last:pb-0">
          {i < entries.length - 1 && (
            <span
              className="absolute left-[7px] top-4 bottom-0 w-px"
              style={{ background: "var(--color-border)" }}
              aria-hidden="true"
            />
          )}
          <span
            className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full"
            style={{ background: "var(--color-primary)" }}
            aria-hidden="true"
          />
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-bold" style={{ color: "var(--color-foreground)" }}>
                {entry.label}
              </span>
              <span className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                {formatDate(entry.date)}
              </span>
            </div>
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              {entry.summary}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
