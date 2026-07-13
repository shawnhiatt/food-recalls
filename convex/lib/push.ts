// Web Push payload copy (SPEC.md §9). Pure, so it's testable without the
// transport. Deliberately narrow: a lock-screen/push notification may only
// carry product name, severity, and a deep link — NEVER the matchedOn
// reasons that name allergens, risk groups, pregnancy, or immunocompromise
// (those stay in-app only, per the §9 push redaction rule). This function's
// signature has no way to accept `matchedOn`, so that rule is enforced by
// construction, not by convention.

import type { Severity } from "./matching";

const SEVERITY_LABEL: Record<Severity, string> = {
  class1: "High risk",
  class2: "Moderate risk",
  class3: "Low risk",
  unknown: "Risk level unknown",
};

export type PushAlert = {
  title: string;
  severity: Severity;
  url: string;
  /** Recall id — used as the notification tag so a later revision replaces
   *  rather than stacks alongside the earlier one on the lock screen. */
  tag: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export function renderPushPayload(alert: PushAlert): PushPayload {
  return {
    title: `${SEVERITY_LABEL[alert.severity]} recall`,
    body: alert.title,
    url: alert.url,
    tag: alert.tag,
  };
}
