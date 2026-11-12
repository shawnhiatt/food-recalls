import Link from "next/link";

// Error and empty states (UX-13): every one gets a title, one plain sentence
// and exactly one way forward, so no screen is a dead end. Same tinted icon
// disc as the feed's EmptyState. Server-safe (no hooks), so it also renders
// from not-found and the error boundaries.

export type StatusAction = { label: string; href: string } | { label: string; onClick: () => void };

const ICONS = {
  missing: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
      <path d="M8.5 11h5" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1" />
    </>
  ),
  bookmark: <path d="M6 3h12v18l-6-4.5L6 21V3z" />,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />,
} as const;

export function StatusMessage({
  title,
  body,
  action,
  icon = "missing",
  headingLevel = "h1",
}: {
  title: string;
  body: string;
  action: StatusAction;
  icon?: keyof typeof ICONS;
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;
  const actionClass = "mt-2 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-white";
  const actionStyle = { background: "var(--color-primary)" };

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--color-secondary)" }}
        aria-hidden="true"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICONS[icon]}
        </svg>
      </div>
      <Heading className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>
        {title}
      </Heading>
      <p className="max-w-xs text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        {body}
      </p>
      {"href" in action ? (
        <Link href={action.href} className={actionClass} style={actionStyle}>
          {action.label}
        </Link>
      ) : (
        <button type="button" onClick={action.onClick} className={actionClass} style={actionStyle}>
          {action.label}
        </button>
      )}
    </div>
  );
}
