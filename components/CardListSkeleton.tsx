// Shared skeleton shape for card-list screens (Feed, Saved) — pwa skill
// design.md: skeletons shaped like real content, not generic gray boxes.
export function CardListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-3 px-4 pb-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex animate-pulse gap-3 rounded-(--radius-base) p-3"
          style={{ border: "1px solid var(--color-border)" }}
        >
          <div className="h-20 w-20 shrink-0 rounded-(--radius-base)" style={{ background: "var(--color-secondary)" }} />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 w-1/3 rounded" style={{ background: "var(--color-secondary)" }} />
            <div className="h-4 w-full rounded" style={{ background: "var(--color-secondary)" }} />
            <div className="h-4 w-2/3 rounded" style={{ background: "var(--color-secondary)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
