import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setupConvex } from "./helpers";

// One-click email unsubscribe (SPEC.md §2). Token-based, no login: flips
// emailOptIn off for the member the token belongs to; push/in-app untouched.

describe("unsubscribe", () => {
  test("a valid token turns off email and previews the affected address", async () => {
    const t = setupConvex();
    await t.mutation(internal.seed.seedDefaultHousehold, {});
    const token = await t.run(async (ctx) => {
      const settings = await ctx.db.query("notificationSettings").first();
      return settings!.unsubscribeToken!;
    });

    const preview = await t.query(api.unsubscribe.preview, { token });
    expect(preview).toMatchObject({ email: "hello@shawnhiatt.com", alreadyUnsubscribed: false });

    const result = await t.mutation(api.unsubscribe.unsubscribe, { token });
    expect(result.ok).toBe(true);

    await t.run(async (ctx) => {
      const settings = await ctx.db.query("notificationSettings").first();
      expect(settings!.emailOptIn).toBe(false);
    });
  });

  test("an unknown token is a no-op", async () => {
    const t = setupConvex();
    expect(await t.query(api.unsubscribe.preview, { token: "nope" })).toBeNull();
    expect(await t.mutation(api.unsubscribe.unsubscribe, { token: "nope" })).toEqual({ ok: false });
  });
});
