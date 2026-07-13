"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/webPush";
import type { NotificationPreset } from "@/lib/copy";

// Contextual push permission flow (SPEC.md §9 / pwa skill rule 8): the native
// prompt only fires from the explicit "Enable alerts" click below, never on
// page load. The explainer copy and preview vary by the member's preset —
// Recommended/Everything preview a push notification and may promise
// restraint or describe "everything, instantly"; Digest only previews the
// EMAIL digest instead, since that's the channel doing most of the work
// under that preset.

type Status = "idle" | "requesting" | "denied" | "unsupported" | "error";

const PRESET_COPY: Record<
  NotificationPreset,
  { headline: string; body: string; previewKind: "push" | "email" }
> = {
  recommended: {
    headline: "Get notified the moment something urgent affects your household.",
    body:
      "We'll only send a push alert for urgent matches — a high-risk recall involving an allergen or an at-risk person in your household. Everything else arrives in your daily email digest.",
    previewKind: "push",
  },
  everything: {
    headline: "Get a push alert the instant any recall matches your household.",
    body: "Every match, right away — no waiting for the daily digest.",
    previewKind: "push",
  },
  digest_only: {
    headline: "Your alerts arrive once a day by email.",
    body:
      "You've chosen Digest only, so most matches wait for your daily email, like the preview below. Push alerts, if you turn them on, stay quiet except for the most urgent matches — a high-risk recall involving an allergen or an at-risk person in your household.",
    previewKind: "email",
  },
};

export function PushNotificationSetup({
  initialEnabled,
  preset,
}: {
  initialEnabled: boolean;
  preset: NotificationPreset;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [status, setStatus] = useState<Status>("idle");
  const subscribe = useMutation(api.pushSubscriptions.subscribe);
  const unsubscribe = useMutation(api.pushSubscriptions.unsubscribe);

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (!supported) setStatus("unsupported");
  }, []);

  async function handleEnable() {
    setStatus("requesting");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const subscription = await subscribeToPush();
      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
        expirationTime?: number | null;
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("incomplete push subscription");
      }
      await subscribe({
        subscription: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          expirationTime: json.expirationTime ?? undefined,
        },
      });
      setEnabled(true);
      setStatus("idle");
    } catch (err) {
      console.error("[push] enable failed", err);
      setStatus("error");
    }
  }

  async function handleDisable() {
    setStatus("requesting");
    try {
      await unsubscribeFromPush();
      await unsubscribe({});
      setEnabled(false);
      setStatus("idle");
    } catch (err) {
      console.error("[push] disable failed", err);
      setStatus("error");
    }
  }

  if (enabled) {
    return (
      <div
        className="mt-3 flex items-center justify-between gap-3 rounded-lg p-3"
        style={{ background: "var(--color-secondary)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-foreground)" }}>
          Push alerts are on for this browser.
        </p>
        <button
          type="button"
          onClick={handleDisable}
          disabled={status === "requesting"}
          className="shrink-0 text-xs font-semibold underline disabled:opacity-50"
          style={{ color: "var(--color-primary-text)" }}
        >
          Turn off
        </button>
      </div>
    );
  }

  const copy = PRESET_COPY[preset];

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
      <p className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
        {copy.headline}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
        {copy.body}
      </p>

      <div className="mt-2.5">
        {copy.previewKind === "push" ? <PushPreview /> : <EmailPreview />}
      </div>

      {status === "unsupported" && (
        <p className="mt-2.5 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          Push notifications aren&apos;t supported in this browser.
        </p>
      )}
      {status === "denied" && (
        <p className="mt-2.5 text-xs" style={{ color: "var(--color-destructive)" }}>
          Notifications are blocked for this site. Enable them in your browser&apos;s site
          settings to turn on alerts.
        </p>
      )}
      {status === "error" && (
        <p className="mt-2.5 text-xs" style={{ color: "var(--color-destructive)" }}>
          Something went wrong enabling alerts. Try again.
        </p>
      )}

      {status !== "unsupported" && (
        <button
          type="button"
          onClick={handleEnable}
          disabled={status === "requesting"}
          className="mt-3 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--color-primary)" }}
        >
          {status === "requesting" ? "Enabling…" : "Enable alerts"}
        </button>
      )}
    </div>
  );
}

function PushPreview() {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border p-2.5"
      style={{ borderColor: "var(--color-border)", background: "var(--color-background)" }}
    >
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
        style={{ background: "var(--color-primary)" }}
        aria-hidden
      >
        FR
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
            Food Recalls
          </span>
          <span className="text-[11px]" style={{ color: "var(--color-muted-foreground)" }}>
            now
          </span>
        </div>
        <p className="text-xs font-bold" style={{ color: "var(--color-foreground)" }}>
          High risk recall
        </p>
        <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          Example Snack Co. bars — tap to view
        </p>
      </div>
    </div>
  );
}

function EmailPreview() {
  return (
    <div
      className="rounded-lg border p-2.5"
      style={{ borderColor: "var(--color-border)", background: "var(--color-background)" }}
    >
      <p className="text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
        Subject: 1 new recall matches your household
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
        High risk: Example Snack Co. bars — View the recall →
      </p>
    </div>
  );
}
