import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "../convex/_generated/api";
import { setupConvex } from "./helpers";

// Household read-only summary (SPEC.md §2/§12): gated by a shared pilot
// secret checked against PILOT_ACCESS_SECRET — never publicly queryable.

const SECRET = "test-pilot-secret";

beforeEach(() => {
  process.env.PILOT_ACCESS_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.PILOT_ACCESS_SECRET;
});

describe("household.getPilotSummary", () => {
  test("rejects a missing/incorrect secret", async () => {
    const t = setupConvex();
    await expect(t.query(api.household.getPilotSummary, { secret: "wrong" })).rejects.toThrow(
      ConvexError,
    );
  });

  test("rejects when PILOT_ACCESS_SECRET is unset on the deployment", async () => {
    delete process.env.PILOT_ACCESS_SECRET;
    const t = setupConvex();
    await expect(t.query(api.household.getPilotSummary, { secret: SECRET })).rejects.toThrow(
      ConvexError,
    );
  });

  test("returns the seeded household's summary with the correct secret", async () => {
    const t = setupConvex();
    await t.mutation(internal.seed.seedDefaultHousehold, {});

    const result = await t.query(api.household.getPilotSummary, { secret: SECRET });
    expect(result).not.toBeNull();
    expect(result!.householdName).toBe("Hiatt household");
    expect(result!.states).toEqual(["NC"]);
    expect(result!.preset).toBe("recommended");
    expect(result!.summary).toContain("Recalls in NC");
  });

  test("returns null when no household has been seeded", async () => {
    const t = setupConvex();
    const result = await t.query(api.household.getPilotSummary, { secret: SECRET });
    expect(result).toBeNull();
  });
});
