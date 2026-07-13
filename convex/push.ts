"use node";

// Web Push delivery (SPEC.md §5, §9). `web-push` needs real Node crypto/https,
// so this file is a Node action — kept thin like lib/email.ts's sendEmail:
// all matching/dedupe/routing lives in notifications.ts, this only talks to
// the push service.
//
// The `web-push` import is dynamic and gated behind the "are keys configured"
// check (mirroring sendEmail's RESEND_API_KEY guard) so an unconfigured dev/
// test environment never even loads the module, let alone calls it.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const pushSubscriptionValidator = v.object({
  endpoint: v.string(),
  keys: v.object({
    p256dh: v.string(),
    auth: v.string(),
  }),
  expirationTime: v.optional(v.union(v.number(), v.null())),
});

const pushPayloadValidator = v.object({
  title: v.string(),
  body: v.string(),
  url: v.string(),
  tag: v.string(),
});

export type SendPushResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true } // no VAPID keys configured
  | { ok: false; error: string };

/**
 * Send one push notification. No-ops (with a logged warning) when
 * VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are unset, so the pilot, tests, and
 * local dev never require live push (§14 Phase 3 parity with §9 email).
 */
export const sendPushNotification = internalAction({
  args: {
    memberId: v.id("members"),
    subscription: pushSubscriptionValidator,
    payload: pushPayloadValidator,
  },
  handler: async (ctx, { memberId, subscription, payload }): Promise<SendPushResult> => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      console.warn(
        "[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset — skipping send to member " +
          memberId,
      );
      return { ok: true, skipped: true };
    }

    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:alerts@foodrecalls.app",
      publicKey,
      privateKey,
    );

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      return { ok: true };
    } catch (err) {
      const statusCode =
        typeof err === "object" && err !== null && "statusCode" in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;
      // Push service says the subscription is gone — stop trying it.
      if (statusCode === 404 || statusCode === 410) {
        await ctx.runMutation(internal.pushSubscriptions.clearSubscription, {
          memberId,
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[push] send failed to member ${memberId}: ${message}`);
      return { ok: false, error: message };
    }
  },
});
