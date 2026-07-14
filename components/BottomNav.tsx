"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// SPEC.md §12: Feed / Scanner / Saved / Household, 4 tabs — Scanner appears
// when built (Phase 7).
const TABS: Array<{ href: string; label: string; icon: (active: boolean) => ReactNode }> = [
  { href: "/", label: "Feed", icon: FeedIcon },
  { href: "/saved", label: "Saved", icon: SavedIcon },
  { href: "/household", label: "Household", icon: HouseholdIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  const matches = useQuery(api.feed.myMatches, {});
  // §12: the Feed badge is a count of ACTIVE household-matched alerts, not an
  // unread count — it clears as matches resolve/archive, not on view.
  const activeMatchCount = (matches ?? []).filter((m) =>
    m.alertType === "recall" ? m.recall.lifecycle === "active" : m.outbreak.status === "active",
  ).length;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-(--color-card)"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const badge = tab.href === "/" && activeMatchCount > 0 ? activeMatchCount : null;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="no-select relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-medium active:opacity-60"
                style={{ color: active ? "var(--color-primary)" : "var(--color-muted-foreground)" }}
              >
                <span className="relative">
                  {tab.icon(active)}
                  {badge !== null && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                      style={{ background: "var(--color-destructive)" }}
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                {tab.label}
                {badge !== null && <span className="sr-only">, {badge} alerts match your household</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function iconProps(active: boolean) {
  return {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: active ? 2.25 : 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function FeedIcon(active: boolean) {
  return (
    <svg {...iconProps(active)}>
      <path d="M4 4h16v4H4z" />
      <path d="M4 12h16" />
      <path d="M4 16h10" />
      <path d="M4 20h7" />
    </svg>
  );
}

function SavedIcon(active: boolean) {
  return (
    <svg {...iconProps(active)}>
      <path d="M6 3h12v18l-6-4.5L6 21V3z" />
    </svg>
  );
}

function HouseholdIcon(active: boolean) {
  return (
    <svg {...iconProps(active)}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}
