import type { Metadata } from "next";
import { RecallDetail } from "@/components/RecallDetail";

// Static, not per-recall: Next.js 15 streams async generateMetadata output
// via a client-side script when it depends on a data fetch, so the
// <title>/<meta description> wouldn't actually be present in the initial
// HTML <head> — invisible to Lighthouse and, more importantly, to any
// link-unfurler (Slack, iMessage, etc.) that doesn't execute JS, which
// defeats the point of the ShareButton's deep link. A synchronous, static
// description is worse for personalization but actually crawler-visible.
export const metadata: Metadata = {
  title: "Recall details — Food Recalls",
  description:
    "Recall risk level, affected states, allergens, and update timeline. Data from openFDA/FSIS.",
};

export default function RecallDetailPage() {
  return <RecallDetail />;
}
