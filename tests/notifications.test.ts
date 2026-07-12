import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setupConvex } from "./helpers";

// Stateful dispatch (SPEC.md §9 decision matrix + dedupe). The pure matcher and
// routing rules are in matching.test.ts; here we cover the DB-backed rows:
// per-revision dedupe, digest queueing, closures, and the pref-change guard —
// plus the §14 replay-idempotency and empty-digest requirements.

// Fake timers (fixed at a recent instant so the §9 freshness guard stays
// deterministic) let us drain the instant-email delivery actions the dispatch
// mutation schedules — otherwise convex-test runs them after teardown and warns
// about writes outside a transaction.
beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-11T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

const DAY = 24 * 60 * 60 * 1000;
const recentDate = () => new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);

type PrefsOverride = {
  states?: string[];
  brands?: string[];
  keywords?: string[];
  allergens?: string[];
  pets?: Array<"dog" | "cat" | "other">;
  categories?: { humanFood: boolean; petFood: boolean; outbreaks: boolean };
  members?: Array<{
    ageBand: "infant" | "child" | "adult" | "older_adult";
    pregnant?: boolean;
    immunocompromised?: boolean;
  }>;
};

type SettingsOverride = {
  emailOptIn?: boolean;
  digestEnabled?: boolean;
  urgencyThreshold?: "class1_only" | "class1_plus_allergen" | "everything";
  digestHour?: number;
  timezone?: string;
  lastDigestAt?: number;
};

async function seedHousehold(
  t: ReturnType<typeof setupConvex>,
  prefs: PrefsOverride = {},
  settings: SettingsOverride = {},
): Promise<{ householdId: Id<"households">; memberId: Id<"members"> }> {
  return await t.run(async (ctx) => {
    const householdId = await ctx.db.insert("households", { name: "Test household" });
    await ctx.db.insert("householdPreferences", {
      householdId,
      states: prefs.states ?? ["NC"],
      brands: prefs.brands ?? [],
      keywords: prefs.keywords ?? [],
      chains: [],
      allergens: prefs.allergens ?? [],
      categories: prefs.categories ?? { humanFood: true, petFood: true, outbreaks: true },
      pets: prefs.pets ?? [],
      members: (prefs.members ?? []).map((m) => ({
        label: "M",
        labelPinned: false,
        ageBand: m.ageBand,
        pregnant: m.pregnant,
        immunocompromised: m.immunocompromised,
      })),
    });
    const memberId = await ctx.db.insert("members", {
      householdId,
      email: "member@example.com",
    });
    await ctx.db.insert("notificationSettings", {
      memberId,
      emailOptIn: settings.emailOptIn ?? true,
      pushOptIn: false,
      urgencyThreshold: settings.urgencyThreshold ?? "class1_plus_allergen",
      digestEnabled: settings.digestEnabled ?? true,
      digestHour: settings.digestHour ?? 17,
      timezone: settings.timezone ?? "UTC",
      lastDigestAt: settings.lastDigestAt,
    });
    return { householdId, memberId };
  });
}

type RecallOverride = {
  classification?: string;
  lifecycle?: "active" | "completed" | "terminated" | "withdrawn" | "corrected";
  states?: string[];
  allergens?: string[];
  riskGroups?: string[];
  audience?: "human" | "pet" | "unknown";
  recallDate?: string;
  contentHash?: string;
  title?: string;
};

async function insertRecall(
  t: ReturnType<typeof setupConvex>,
  over: RecallOverride = {},
): Promise<Id<"recalls">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("recalls", {
      source: "fda",
      sourceId: `S-${Math.random()}`,
      title: over.title ?? "Test recall",
      firm: "Acme Foods",
      classification: over.classification ?? "Class I",
      rawStatus: "Ongoing",
      lifecycle: over.lifecycle ?? "active",
      recallDate: over.recallDate ?? recentDate(),
      productDesc: "Snack bars",
      states: over.states ?? ["NC"],
      distribution: "NC",
      productCodes: [],
      allergens: over.allergens ?? [],
      audience: over.audience ?? "human",
      hazardType: "microbial",
      riskGroups: over.riskGroups ?? [],
      sourceUrl: "https://example/recall",
      raw: {},
      contentHash: over.contentHash ?? "hash-1",
      updateHistory: [],
      firstSeenAt: now,
      updatedAt: now,
    });
  });
}

const sentRows = (t: ReturnType<typeof setupConvex>) =>
  t.run((ctx) => ctx.db.query("notificationsSent").collect());
const queueRows = (t: ReturnType<typeof setupConvex>) =>
  t.run((ctx) => ctx.db.query("digestQueue").collect());

// dispatchForRecall schedules the instant-email delivery action; drain it so
// the (no-op without RESEND_API_KEY) send runs inside a transaction rather than
// leaking a post-test scheduled write.
async function dispatch(
  t: ReturnType<typeof setupConvex>,
  args: { recallId: Id<"recalls">; event: "new" | "material" | "closure" },
) {
  const res = await t.mutation(internal.notifications.dispatchForRecall, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return res;
}

describe("instant routing + dedupe (§9)", () => {
  test("Class I state match → instant send recorded once, idempotent on replay", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] });
    const recallId = await insertRecall(t, { classification: "Class I", states: ["NC"] });

    await dispatch(t, {
      recallId,
      event: "new",
    });
    let sent = await sentRows(t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "email", mode: "instant", alertType: "recall" });

    // Replay the exact dispatch (crash-recovery simulation): no duplicate.
    await dispatch(t, {
      recallId,
      event: "new",
    });
    sent = await sentRows(t);
    expect(sent).toHaveLength(1);
    expect(await queueRows(t)).toHaveLength(0);
  });

  test("below-threshold match → digest queue, no instant send", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { urgencyThreshold: "class1_plus_allergen" });
    const recallId = await insertRecall(t, { classification: "Class II", states: ["NC"] });

    await dispatch(t, { recallId, event: "new" });
    expect(await sentRows(t)).toHaveLength(0);
    const q = await queueRows(t);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "match", severity: "class2" });
    expect(q[0]!.matchedOn).toContain("state");
  });

  test("hard floor overrides digest-only preset (class1_only): Class I + allergen → instant", async () => {
    const t = setupConvex();
    await seedHousehold(
      t,
      { states: ["CA"], allergens: ["milk"] }, // state does NOT match; allergen does
      { urgencyThreshold: "class1_only" },
    );
    const recallId = await insertRecall(t, {
      classification: "Class I",
      states: ["TX"],
      allergens: ["milk"],
    });

    await dispatch(t, { recallId, event: "new" });
    const sent = await sentRows(t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ mode: "instant" });
  });

  test("category gate is absolute: pet recall with petFood off → nothing, even Class I + allergen", async () => {
    const t = setupConvex();
    await seedHousehold(
      t,
      {
        states: ["NC"],
        allergens: ["milk"],
        pets: ["dog"],
        categories: { humanFood: true, petFood: false, outbreaks: true },
      },
      { urgencyThreshold: "everything" },
    );
    const recallId = await insertRecall(t, {
      classification: "Class I",
      audience: "pet",
      states: ["NC"],
      allergens: ["milk"],
    });

    await dispatch(t, { recallId, event: "new" });
    expect(await sentRows(t)).toHaveLength(0);
    expect(await queueRows(t)).toHaveLength(0);
  });

  test("no channel opted in → no notification", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { emailOptIn: false });
    const recallId = await insertRecall(t, { classification: "Class I", states: ["NC"] });
    await dispatch(t, { recallId, event: "new" });
    expect(await sentRows(t)).toHaveLength(0);
    expect(await queueRows(t)).toHaveLength(0);
  });

  test("stale new alert (old recallDate) never notifies — backfill guard", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { urgencyThreshold: "everything" });
    const recallId = await insertRecall(t, {
      classification: "Class I",
      states: ["NC"],
      recallDate: "2024-01-01",
    });
    const res = await dispatch(t, {
      recallId,
      event: "new",
    });
    expect(res).toMatchObject({ dispatched: 0 });
    expect(await sentRows(t)).toHaveLength(0);
  });
});

describe("material updates (§9)", () => {
  test("a new revision re-notifies; the same revision does not", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { urgencyThreshold: "everything" });
    const recallId = await insertRecall(t, {
      classification: "Class I",
      states: ["NC"],
      contentHash: "rev-1",
    });

    await dispatch(t, { recallId, event: "new" });
    expect(await sentRows(t)).toHaveLength(1);

    // Simulate a material update: bump the stored revision, then dispatch.
    await t.run(async (ctx) => {
      await ctx.db.patch(recallId, { contentHash: "rev-2", classification: "Class I" });
    });
    await dispatch(t, { recallId, event: "material" });
    const sent = await sentRows(t);
    expect(sent).toHaveLength(2);
    expect(sent.map((s) => s.contentHash).sort()).toEqual(["rev-1", "rev-2"]);
  });
});

describe("closures (§9 lifecycle rows)", () => {
  test("previously-notified member gets a digest closure line; never instant", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { urgencyThreshold: "everything" });
    const recallId = await insertRecall(t, {
      classification: "Class I",
      states: ["NC"],
      contentHash: "rev-1",
    });

    // First: notify instantly.
    await dispatch(t, { recallId, event: "new" });
    expect(await sentRows(t)).toHaveLength(1);

    // Then: close it out.
    await t.run(async (ctx) => {
      await ctx.db.patch(recallId, { lifecycle: "completed", contentHash: "rev-2" });
    });
    await dispatch(t, { recallId, event: "closure" });

    // No new instant send; a closure line is queued for the digest.
    expect(await sentRows(t)).toHaveLength(1);
    const q = await queueRows(t);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "closure" });
  });

  test("never-notified member gets no closure line (timeline only)", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] });
    const recallId = await insertRecall(t, {
      classification: "Class III", // below threshold, but we won't even notify
      states: ["CA"], // does not match NC → never notified
      lifecycle: "completed",
    });
    await dispatch(t, { recallId, event: "closure" });
    expect(await queueRows(t)).toHaveLength(0);
    expect(await sentRows(t)).toHaveLength(0);
  });

  test("closing an alert drops a still-pending match line for it", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { urgencyThreshold: "class1_plus_allergen" });
    const recallId = await insertRecall(t, {
      classification: "Class II", // below threshold → queued for digest
      states: ["NC"],
      contentHash: "rev-1",
    });
    await dispatch(t, { recallId, event: "new" });
    expect(await queueRows(t)).toHaveLength(1); // pending match

    await t.run((ctx) => ctx.db.patch(recallId, { lifecycle: "terminated", contentHash: "rev-2" }));
    await dispatch(t, { recallId, event: "closure" });
    // Never instant-notified, so no closure line either — and the stale match
    // line is gone (a resolved recall must not announce itself as new).
    expect(await queueRows(t)).toHaveLength(0);
  });
});

describe("daily digest drain (§9, §10)", () => {
  const DUE_NOW = Date.UTC(2026, 6, 11, 17, 0, 0); // 17:00 UTC

  async function markSourcesCurrent(t: ReturnType<typeof setupConvex>, now: number) {
    await t.run(async (ctx) => {
      for (const source of ["fda", "fsis"] as const) {
        await ctx.db.insert("sourceHealth", {
          source,
          state: "current",
          lastAttemptAt: now,
          lastSuccessAt: now,
          consecutiveFailures: 0,
        });
      }
    });
  }

  test("drains queued matches into one message, records the send, empties the queue", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { digestHour: 17, timezone: "UTC" });
    await markSourcesCurrent(t, DUE_NOW);
    const recallId = await insertRecall(t, {
      classification: "Class II",
      states: ["NC"],
      title: "Moderate spinach recall",
    });
    await dispatch(t, { recallId, event: "new" });
    expect(await queueRows(t)).toHaveLength(1);

    const { messages } = await t.mutation(internal.notifications.drainDueDigests, {
      now: DUE_NOW,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.subject).toMatch(/1 new recall/i);
    expect(messages[0]!.text).toMatch(/Moderate spinach recall/);
    expect(await queueRows(t)).toHaveLength(0); // drained
    const sent = await sentRows(t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ mode: "digest" });
  });

  test("empty digest still sends — reassurance when all sources current", async () => {
    const t = setupConvex();
    await seedHousehold(t, {}, { digestHour: 17, timezone: "UTC" });
    await markSourcesCurrent(t, DUE_NOW);
    const { messages } = await t.mutation(internal.notifications.drainDueDigests, {
      now: DUE_NOW,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toMatch(/no new recalls affect your household/i);
    expect(messages[0]!.text).not.toMatch(/coverage incomplete/i);
  });

  test("empty digest with a degraded source → incompleteness copy, never all-clear", async () => {
    const t = setupConvex();
    await seedHousehold(t, {}, { digestHour: 17, timezone: "UTC" });
    await t.run(async (ctx) => {
      await ctx.db.insert("sourceHealth", {
        source: "fda",
        state: "current",
        lastAttemptAt: DUE_NOW,
        lastSuccessAt: DUE_NOW,
        consecutiveFailures: 0,
      });
      await ctx.db.insert("sourceHealth", {
        source: "fsis",
        state: "delayed",
        lastAttemptAt: DUE_NOW,
        lastSuccessAt: DUE_NOW - 6 * DAY,
        consecutiveFailures: 3,
      });
    });
    const { messages } = await t.mutation(internal.notifications.drainDueDigests, {
      now: DUE_NOW,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toMatch(/coverage incomplete/i);
    expect(messages[0]!.text).not.toMatch(/no new recalls affect your household\./i);
  });

  test("not due outside the member's digest hour", async () => {
    const t = setupConvex();
    await seedHousehold(t, {}, { digestHour: 9, timezone: "UTC" });
    await markSourcesCurrent(t, DUE_NOW);
    const { messages } = await t.mutation(internal.notifications.drainDueDigests, {
      now: DUE_NOW, // 17:00, member wants 09:00
    });
    expect(messages).toHaveLength(0);
  });

  test("replay: draining again the same day sends zero duplicate digests", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { digestHour: 17, timezone: "UTC" });
    await markSourcesCurrent(t, DUE_NOW);
    const recallId = await insertRecall(t, { classification: "Class II", states: ["NC"] });
    await dispatch(t, { recallId, event: "new" });

    const first = await t.mutation(internal.notifications.drainDueDigests, { now: DUE_NOW });
    expect(first.messages).toHaveLength(1);
    // Same day, an hour later: the lastDigestAt guard suppresses a second send.
    const second = await t.mutation(internal.notifications.drainDueDigests, {
      now: DUE_NOW + 3600 * 1000,
    });
    expect(second.messages).toHaveLength(0);
    expect(await sentRows(t)).toHaveLength(1); // no duplicate digest record
  });

  test("preference change never notifies: an old matched active recall not in the queue stays out of the digest", async () => {
    // The digest reads ONLY the eager queue, which is populated on new/material/
    // closure events — never on preference changes. So an alert that a pref
    // change newly matches (and was never enqueued) can't appear in a digest.
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] }, { digestHour: 17, timezone: "UTC" });
    await markSourcesCurrent(t, DUE_NOW);
    // A matching, active recall exists but was never dispatched (simulating a
    // recall that only became relevant after a preference edit).
    await insertRecall(t, { classification: "Class I", states: ["NC"], title: "Pref-only match" });

    const { messages } = await t.mutation(internal.notifications.drainDueDigests, {
      now: DUE_NOW,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).not.toMatch(/Pref-only match/);
    expect(messages[0]!.text).toMatch(/no new recalls affect your household/i);
  });
});
