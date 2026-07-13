import type { Metadata } from "next";
import { OutbreakDetail } from "@/components/OutbreakDetail";

// Static metadata for the same reason as app/recalls/[id]/page.tsx: Next.js
// 15's streamed async generateMetadata never lands in the initial HTML
// <head>, defeating crawlers and unfurlers. See that file's comment.
export const metadata: Metadata = {
  title: "Outbreak details — Food Recalls",
  description:
    "Outbreak status, affected states, who's at risk, and the investigation timeline. Data from CDC.",
};

export default function OutbreakDetailPage() {
  return <OutbreakDetail />;
}
