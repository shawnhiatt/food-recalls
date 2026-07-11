import { OfflineRetry } from "@/components/OfflineRetry";

export const metadata = { title: "You're offline — Food Recalls" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: "var(--color-secondary)" }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 1l22 22" />
          <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
          <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0122.58 9" />
          <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
          <path d="M8.53 16.11a6 6 0 016.95 0" />
          <path d="M12 20h.01" />
        </svg>
      </div>
      <h1 className="text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
        You&apos;re offline
      </h1>
      <p className="max-w-xs text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        Food Recalls needs a connection to check for the latest recalls. Reconnect and
        we&apos;ll pick up right where you left off.
      </p>
      <OfflineRetry />
    </main>
  );
}
