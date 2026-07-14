import Link from "next/link";
import { SourceStatusPill } from "@/components/SourceHealthBanner";

// Always-visible source-status indicator (SPEC.md §10): "a 'Current' pill in
// the mobile header" — rendered on every screen via the root layout. Also hosts
// the search entry point (§10 search), kept out of the spec'd 4-tab bottom nav.
export function Header() {
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: "var(--color-background)",
        paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))",
      }}
    >
      <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
        <span className="text-lg font-black" style={{ color: "var(--color-foreground)" }}>
          Food Recalls
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/search"
            aria-label="Search recalls and outbreaks"
            className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </Link>
          <SourceStatusPill />
        </div>
      </div>
    </header>
  );
}
