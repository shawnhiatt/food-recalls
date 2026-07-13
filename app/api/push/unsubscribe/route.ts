import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// Server-side only (SPEC.md §2) — see app/api/push/subscribe/route.ts.
export async function POST() {
  const secret = process.env.PILOT_ACCESS_SECRET;
  if (!secret) {
    return Response.json({ error: "PILOT_ACCESS_SECRET is not set" }, { status: 500 });
  }

  try {
    await fetchMutation(api.pushSubscriptions.unsubscribe, { secret });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[push] unsubscribe failed", err);
    return Response.json({ error: "unsubscribe failed" }, { status: 500 });
  }
}
