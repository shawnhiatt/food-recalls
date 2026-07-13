import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// Server-side only (SPEC.md §2): PILOT_ACCESS_SECRET must never reach the
// browser, so the client posts just the PushSubscription JSON here and this
// route attaches the secret itself before calling Convex — mirroring how the
// Household page's Server Component fetches the pilot summary.
export async function POST(request: Request) {
  const secret = process.env.PILOT_ACCESS_SECRET;
  if (!secret) {
    return Response.json({ error: "PILOT_ACCESS_SECRET is not set" }, { status: 500 });
  }

  let subscription: unknown;
  try {
    subscription = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!isPushSubscriptionJson(subscription)) {
    return Response.json({ error: "invalid push subscription shape" }, { status: 400 });
  }

  try {
    await fetchMutation(api.pushSubscriptions.subscribe, { secret, subscription });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[push] subscribe failed", err);
    return Response.json({ error: "subscribe failed" }, { status: 500 });
  }
}

function isPushSubscriptionJson(value: unknown): value is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.endpoint !== "string") return false;
  if (typeof v.keys !== "object" || v.keys === null) return false;
  const keys = v.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}
