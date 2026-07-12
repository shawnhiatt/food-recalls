// Email transport + instant-alert copy (SPEC.md §9). Sends via Resend's HTTP
// API from a Convex action (§5). The transport is a thin fetch wrapper — no SDK
// dependency — and NO-OPS with a logged warning when RESEND_API_KEY is unset,
// so the pilot, tests, and local dev never require live mail.
//
// Instant emails go to the household's own members (not a lock screen), so they
// may name match reasons. The §9 push/lock-screen redaction of health-attribute
// reasons is a Phase-3 push concern, enforced separately when push lands.

import type { MatchDimension, Severity } from "./matching";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type SendResult =
  | { ok: true; id: string | null; skipped?: false }
  | { ok: true; id: null; skipped: true } // no API key configured
  | { ok: false; error: string };

/**
 * Send one email through Resend. Returns a structured result rather than
 * throwing, so a single bad address never aborts a batch of instant sends or a
 * digest run. Requires RESEND_API_KEY and RESEND_FROM in the Convex env.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.warn(
      "[email] RESEND_API_KEY/RESEND_FROM unset — skipping send to " +
        message.to,
    );
    return { ok: true, id: null, skipped: true };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Instant-alert copy (pure, so it's testable without the transport).
// ---------------------------------------------------------------------------

const SEVERITY_LABEL: Record<Severity, string> = {
  class1: "High risk",
  class2: "Moderate risk",
  class3: "Low risk",
  unknown: "Risk level unknown",
};

const DIMENSION_LABEL: Record<MatchDimension, string> = {
  state: "your state",
  brand: "a brand you follow",
  keyword: "a keyword you follow",
  allergen: "an allergen in your household",
  risk_group: "an at-risk member of your household",
  pet: "your pet",
  chain: "a store you shop at",
};

export type InstantAlert = {
  title: string;
  firm: string;
  severity: Severity;
  matchedOn: MatchDimension[];
  url: string;
};

export function instantSubject(alert: InstantAlert): string {
  return `[${SEVERITY_LABEL[alert.severity]}] Recall: ${alert.title}`;
}

export function renderInstantText(alert: InstantAlert, householdName: string): string {
  const reasons = alert.matchedOn.map((d) => DIMENSION_LABEL[d]).join(", ");
  const lines = [
    `Food Recalls — a recall affects ${householdName}.`,
    "",
    `${SEVERITY_LABEL[alert.severity]}: ${alert.title}`,
    `Company: ${alert.firm}`,
  ];
  if (reasons) lines.push(`Matched because it involves: ${reasons}.`);
  lines.push("");
  lines.push(`View the recall: ${alert.url}`);
  lines.push("");
  lines.push(
    "Data from openFDA/FSIS — unvalidated, not an official alerting service. Verify against the official notice.",
  );
  return lines.join("\n");
}
