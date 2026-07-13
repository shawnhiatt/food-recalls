import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

// Convex Auth SSR cookie/token handling (Phase 5). No route protection here:
// the recall/outbreak feed and detail pages are a public safety surface, and
// the sensitive Household/Saved/onboarding screens are gated client-side plus
// enforced server-side by per-household authorization (convex/lib/auth.ts).
export default convexAuthNextjsMiddleware();

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
