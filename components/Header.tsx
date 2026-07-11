import { SourceStatusPill } from "@/components/SourceHealthBanner";

// Always-visible source-status indicator (SPEC.md §10): "a 'Current' pill in
// the mobile header" — rendered on every screen via the root layout.
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
        <SourceStatusPill />
      </div>
    </header>
  );
}
