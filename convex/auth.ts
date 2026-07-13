import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP } from "./ResendOTP";
import { claimMemberForUser } from "./lib/members";
import type { MutationCtx } from "./_generated/server";

// Convex Auth entry point (SPEC.md §5). Single provider: passwordless email
// OTP (see ResendOTP.ts). `signIn`/`signOut` are the public actions the
// frontend calls via useAuthActions(); `auth` exposes the current identity to
// server code and mounts the HTTP auth routes (convex/http.ts).
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],
  callbacks: {
    // After a user's email is verified, bind them to any unclaimed member row
    // for that address (the pilot owner, or a household-seeded member). This is
    // what lets the existing pilot household transition to real auth with no
    // migration step for the human. See claimMemberForUser for the invariants.
    async afterUserCreatedOrUpdated(ctx, { userId, profile }) {
      const email = typeof profile.email === "string" ? profile.email : null;
      if (!email) return;
      // The callback is typed against AnyDataModel; our tables are known.
      await claimMemberForUser(ctx as unknown as MutationCtx, userId, email);
    },
  },
});
