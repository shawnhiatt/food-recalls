"use client";

import { useEffect } from "react";
import "./globals.css";

// Last-resort boundary (T8 / UX-13): replaces the root layout when the layout
// itself throws, so it renders its own <html>/<body> and can't rely on the
// header, tab bar or Convex provider. Kept dependency-free on purpose.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
          <h1 className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>
            Something went wrong
          </h1>
          <p className="max-w-xs text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            Food Recalls couldn&apos;t load. Reload to try again.
          </p>
          {/* A full reload, not reset(): the root layout is what failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="mt-2 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-white"
            style={{ background: "var(--color-primary)" }}
          >
            Reload Food Recalls
          </a>
        </main>
      </body>
    </html>
  );
}
