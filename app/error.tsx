"use client";

import { useEffect } from "react";
import { StatusMessage } from "@/components/StatusMessage";

// Route-level error boundary (T8 / UX-13). Any query or render error below
// the root layout degrades to this page, inside the normal header and tab
// bar, instead of Next's blank "Application error" screen.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main>
      <StatusMessage
        icon="error"
        title="Something went wrong"
        body="This page couldn't load. Your household settings are safe. Try again, or head back to the feed."
        action={{ label: "Try again", onClick: reset }}
      />
    </main>
  );
}
