import { Email } from "@convex-dev/auth/providers/Email";
import { sendEmail } from "./lib/email";

// Email one-time-code provider for Convex Auth (SPEC.md §5/§17.7 — email
// verification). Passwordless: the user enters their email, receives an 8-digit
// code, and typing it back proves they own the address. Reuses the same Resend
// HTTP transport as notifications (convex/lib/email.ts) rather than adding the
// Resend SDK — and, like that transport, degrades gracefully when Resend is
// unconfigured so local dev and tests never require live mail.
//
// The library's default `authorize` still checks that the email supplied at
// verification matches the one the code was issued for, which is what makes a
// short (low-entropy) numeric code safe to use as the sole credential.
export const ResendOTP = Email({
  id: "resend-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    // 8 digits from a CSPRNG (Convex's V8 runtime provides Web Crypto).
    const buf = new Uint32Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => (n % 10).toString()).join("");
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const result = await sendEmail({
      to: email,
      subject: "Your Food Recalls sign-in code",
      text: [
        `Your Food Recalls sign-in code is: ${token}`,
        "",
        "Enter it in the app to finish signing in. It expires in 15 minutes.",
        "If you didn't request this, you can safely ignore this email.",
      ].join("\n"),
    });

    // Resend not configured (dev/test): surface the code in the logs so sign-in
    // is still exercisable locally. Never reached once RESEND_API_KEY is set.
    if (result.ok && result.skipped) {
      console.warn(`[auth] Resend unset — sign-in code for ${email} is ${token}`);
      return;
    }
    if (!result.ok) {
      throw new Error(`Failed to send sign-in code: ${result.error}`);
    }
  },
});
