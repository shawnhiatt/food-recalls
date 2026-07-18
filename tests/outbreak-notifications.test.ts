import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setupConvex } from "./helpers";

// Outbreak notification dispatch (§4 Phase 4/§9, TODO #8) — the outbreak analog
// of tests/notifications.test.ts. Active outbreaks are Class I-equivalent for
// alerting (§4), gated by the household `outbreaks` category toggle, delivered
// instant (email/push), with a resolution → digest closure line. Pure matcher/
// router rules live in matching.test.ts; pure digest copy in digest.test.ts.

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-11T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

const DAY = 24 * 60 * 60 * 1000;
const recentDate = () => new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);

type PrefsOverride = {
  states?: string[];
  categories?: { humanFood: boolean; petFood: boolean; outbreaks: boolean };
  members?: Array<{ ageBand: "infant" | "child" | "adult" | "older_adult"; pregnant?: boolean; immunocompromised?: boolean }>;
};

type SettingsOverride = {
  emailOptIn?: boolean;
  pushOptIn?: boolean;
  pushSubscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  urgencyThreshold?: "class1_only" | "class1_plus_allergen" | "everything";
  digestEnabled?: boolean;
  digestHour?: number;
  timezone?: string;
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
      brands: [],
      keywords: [],
      chains: [],
      allergens: [],
      categories: prefs.categories ?? { humanFood: true, petFood: true, outbreaks: true },
      pets: [],
      members: (prefs.members ?? []).map((m) => ({
        label: "M",
        labelPinned: false,
        ageBand: m.ageBand,
        pregnant: m.pregnant,
        immunocompromised: m.immunocompromised,
      })),
    });
    const memberId = await ctx.db.insert("members", { householdId, email: "member@example.com" });
    await ctx.db.insert("notificationSettings", {
      memberId,
      emailOptIn: settings.emailOptIn ?? true,
      pushOptIn: settings.pushOptIn ?? false,
      pushSubscription: settings.pushSubscription,
      urgencyThreshold: settings.urgencyThreshold ?? "class1_plus_allergen",
      digestEnabled: settings.digestEnabled ?? true,
      digestHour: settings.digestHour ?? 12, // matches the pinned 12:00 UTC clock
      timezone: settings.timezone ?? "UTC",
    });
    return { householdId, memberId };
  });
}

type OutbreakOverride = {
  title?: string;
  states?: string[];
  status?: "active" | "resolved";
  riskGroups?: string[];
  suspectedFood?: string;
  publishedAt?: string;
  contentHash?: string;
};

async function insertOutbreak(
  t: ReturnType<typeof setupConvex>,
  over: OutbreakOverride = {},
): Promise<Id<"outbreaks">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("outbreaks", {
      source: "cdc",
      sourceId: `O-${Math.random()}`,
      title: over.title ?? "E. coli outbreak linked to spinach",
      pathogen: "E. coli",
      suspectedFood: over.suspectedFood,
      states: over.states ?? ["NC"],
      status: over.status ?? "active",
      riskGroups: over.riskGroups ?? [],
      sourceUrl: "https://cdc/outbreak",
      raw: {},
      contentHash: over.contentHash ?? "ohash-1",
      publishedAt: over.publishedAt ?? recentDate(),
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

async function dispatch(
  t: ReturnType<typeof setupConvex>,
  args: { outbreakId: Id<"outbreaks">; event: "new" | "material" | "resolution" },
) {
  const res = await t.mutation(internal.notifications.dispatchForOutbreak, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return res;
}

describe("outbreak instant routing + dedupe (§4/§9)", () => {
  test("active outbreak with a state match → instant email, recorded once, idempotent on replay", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] });
    const outbreakId = await insertOutbreak(t, { states: ["NC"] });

    await dispatch(t, { outbreakId, event: "new" });
    let sent = await sentRows(t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ alertType: "outbreak", channel: "email", mode: "instant" });

    // Replay: dedupe on (member, alert, channel, contentHash) — no second send.
    await dispatch(t, { outbreakId, event: "new" });
    sent = await sentRows(t);
    expect(sent).toHaveLength(1);
  });

  test("hard floor: risk-group match on an active outbreak → instant even at class1_only", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: [], members: [{ ageBand: "infant" }] }, { urgencyThreshold: "class1_only" });
    const outbreakId = await insertOutbreak(t, { states: ["TX"], riskGroups: ["infant"] });

    await dispatch(t, { outbreakId, event: "new" });
    expect(await sentRows(t)).toHaveLength(1);
  });

  test("push channel fires with an outbreak payload when opted in", async () => {
    const t = setupConvex();
    await seedHousehold(
      t,
      { states: ["NC"] },
      { pushOptIn: true, pushSubscription: { endpoint: "https://push/x", keys: { p256dh: "a", auth: "b" } } },
    );
    const outbreakId = await insertOutbreak(t, { states: ["NC"] });

    await dispatch(t, { outbreakId, event: "new" });
    const sent = await sentRows(t);
    expect(sent.some((s) => s.channel === "push" && s.alertType === "outbreak")).toBe(true);
  });
});

describe("outbreak category gate + freshness (§4/§7)", () => {
  test("outbreaks category disabled → no dispatch, even on a clear match", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"], categories: { humanFood: true, petFood: true, outbreaks: false } });
    const outbreakId = await insertOutbreak(t, { states: ["NC"] });

    await dispatch(t, { outbreakId, event: "new" });
    expect(await sentRows(t)).toHaveLength(0);
  });

  test("a stale (old) new outbreak never blasts a notification", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] });
    const outbreakId = await insertOutbreak(t, { states: ["NC"], publishedAt: "2020-01-01" });

    const res = await dispatch(t, { outbreakId, event: "new" });
    expect(res).toMatchObject({ reason: "stale-new" });
    expect(await sentRows(t)).toHaveLength(0);
  });
});

describe("outbreak resolution (§9 closure analog)", () => {
  test("resolution enqueues a digest closure line for a previously-notified member and it renders", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] });
    const outbreakId = await insertOutbreak(t, { states: ["NC"], title: "Salmonella outbreak — onions" });

    // Notify instantly first, so the member has a prior send on record.
    await dispatch(t, { outbreakId, event: "new" });
    expect(await sentRows(t)).toHaveLength(1);

    // The investigation closes.
    await t.run((ctx) => ctx.db.patch(outbreakId, { status: "resolved" as const }));
    await dispatch(t, { outbreakId, event: "resolution" });

    const queued = await queueRows(t);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ alertType: "outbreak", kind: "closure" });

    // The due digest renders it under the resolved/updated heading.
    const { messages } = await t.mutation(internal.notifications.drainDueDigests, {});
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toMatch(/Resolved \/ updated/i);
    expect(messages[0]!.text).toMatch(/Salmonella outbreak — onions — investigation closed/);
  });

  test("resolution for a never-notified member is timeline-only (no closure line)", async () => {
    const t = setupConvex();
    await seedHousehold(t, { states: ["NC"] });
    // Resolved from the start → the member was never instant-notified.
    const outbreakId = await insertOutbreak(t, { states: ["NC"], status: "resolved" });

    await dispatch(t, { outbreakId, event: "resolution" });
    expect(await queueRows(t)).toHaveLength(0);
  });
});
