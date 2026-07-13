import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  decideRoute,
  matchRecall,
  severityOf,
  isFreshForNotification,
  type MatchDimension,
  type MatchResult,
  type Severity,
} from "./lib/matching";
import {
  digestSubject,
  isDigestDue,
  renderDigestText,
  type DigestInput,
  type DigestItem,
} from "./lib/digest";
import {
  instantSubject,
  renderInstantText,
  sendEmail,
  type EmailMessage,
  type InstantAlert,
} from "./lib/email";
import { renderPushPayload } from "./lib/push";
import { computeHealthState, type HealthState } from "./sourceHealth";

// Notification dispatch (SPEC.md §9). The §7 matcher and the §9 decision matrix
// live as pure functions in lib/; this module is the STATEFUL layer: per-member
// dedupe against notificationsSent, instant email/push scheduling, and the
// eager email digest queue. Every send is idempotent on the (member, alert,
// channel, contentHash) tuple — replaying dispatch after a crash sends zero
// duplicates (§14 Phase 2/3).
//
// At-most-once, deliberately: the dedupe row / queue drain is committed BEFORE
// the delivery action runs. A crash between the DB commit and the actual send
// loses that one email/push but never duplicates one — the correct bias for a
// safety tool that must stay trusted (§15 "alert fatigue is the real failure
// mode").
//
// Push (Phase 3) is instant-only — there's no push digest, matching §9's
// model where push is the lock-screen channel and the email digest is the
// sole "quiet" channel. So push only ever fires on `decision.route ===
// "instant"`; it never queues, and it never sends closure/resolution lines
// (§9: "resolved recalls never notify instantly" on ANY channel — email's
// closure line is a digest-only concept). Outbreaks are Phase 4.

function appBase(): string {
  return (process.env.APP_BASE_URL ?? "https://foodrecalls.app").replace(/\/$/, "");
}

function recallUrl(recallId: string): string {
  return `${appBase()}/recalls/${recallId}`;
}

/** One-click email unsubscribe link for a member (§2). Undefined pre-migration. */
function unsubscribeUrl(token: string | undefined): string | undefined {
  return token ? `${appBase()}/unsubscribe?token=${token}` : undefined;
}

/** Has this exact revision already been sent to the member on this channel? */
async function hasSentRevision(
  ctx: MutationCtx,
  memberId: Id<"members">,
  alertId: string,
  contentHash: string,
  channel: "email" | "push",
): Promise<boolean> {
  const sends = await ctx.db
    .query("notificationsSent")
    .withIndex("by_member_alert", (q) =>
      q.eq("memberId", memberId).eq("alertId", alertId).eq("channel", channel),
    )
    .collect();
  return sends.some((s) => s.contentHash === contentHash);
}

async function queueRowsFor(
  ctx: MutationCtx,
  memberId: Id<"members">,
  alertId: string,
): Promise<Doc<"digestQueue">[]> {
  return await ctx.db
    .query("digestQueue")
    .withIndex("by_member_alert", (q) =>
      q.eq("memberId", memberId).eq("alertId", alertId),
    )
    .collect();
}

async function enqueueMatch(
  ctx: MutationCtx,
  params: {
    memberId: Id<"members">;
    recall: Doc<"recalls">;
    match: MatchResult;
    severity: Severity;
    now: number;
  },
): Promise<void> {
  const { memberId, recall, match, severity, now } = params;
  // Already emailed this revision → nothing to queue. (The digest is
  // email-only; push never queues, so this check is always channel "email".)
  if (await hasSentRevision(ctx, memberId, recall._id, recall.contentHash, "email")) {
    return;
  }
  const rows = await queueRowsFor(ctx, memberId, recall._id);
  const existingMatch = rows.find((r) => r.kind === "match");
  const row = {
    memberId,
    alertId: recall._id as string,
    alertType: "recall" as const,
    contentHash: recall.contentHash,
    kind: "match" as const,
    matchedOn: match.matchedOn as string[],
    confidence: match.overallConfidence,
    severity,
    queuedAt: now,
  };
  // Refresh an existing queued line to the latest revision so the digest never
  // shows stale data; otherwise insert a new line.
  if (existingMatch) await ctx.db.patch(existingMatch._id, row);
  else await ctx.db.insert("digestQueue", row);
}

async function enqueueClosure(
  ctx: MutationCtx,
  params: {
    memberId: Id<"members">;
    recall: Doc<"recalls">;
    severity: Severity;
    now: number;
  },
): Promise<void> {
  const { memberId, recall, severity, now } = params;
  const rows = await queueRowsFor(ctx, memberId, recall._id);
  const existingClosure = rows.find((r) => r.kind === "closure");
  const row = {
    memberId,
    alertId: recall._id as string,
    alertType: "recall" as const,
    contentHash: recall.contentHash,
    kind: "closure" as const,
    matchedOn: [] as string[],
    confidence: "high" as const,
    severity,
    queuedAt: now,
  };
  if (existingClosure) await ctx.db.patch(existingClosure._id, row);
  else await ctx.db.insert("digestQueue", row);
}

/**
 * Match one recall revision against every household and route notifications per
 * the §9 matrix. Scheduled by `recalls.upsertBatch` on insert (event 'new'),
 * material revision ('material'), and lifecycle-into-closed transition
 * ('closure'). Runs after the upsert commits, so the recall is readable here.
 */
export const dispatchForRecall = internalMutation({
  args: {
    recallId: v.id("recalls"),
    event: v.union(
      v.literal("new"),
      v.literal("material"),
      v.literal("closure"),
    ),
  },
  handler: async (ctx, { recallId, event }) => {
    const recall = await ctx.db.get(recallId);
    if (!recall) return { dispatched: 0 };
    const now = Date.now();
    const severity = severityOf(recall.classification);

    // Backfill guard: a NEW alert only notifies if recently published. Old
    // records surface in the feed's household section (re-rank) but never blast
    // the digest (§7, §17.11).
    if (event === "new" && !isFreshForNotification(recall.recallDate, now)) {
      return { dispatched: 0, reason: "stale-new" as const };
    }

    // §17.12 / §10: a material update to an already-closed recall is timeline
    // only — resolved/withdrawn recalls never notify, and non-active records
    // are excluded from matching. Transitions INTO a closed lifecycle arrive
    // as their own 'closure' event and are handled below; this guards the
    // closed→closed edit that upsertBatch no longer schedules (defense in
    // depth, like the freshness guard above).
    if (event === "material" && recall.lifecycle !== "active") {
      return { dispatched: 0, reason: "closed-material" as const };
    }

    const households = await ctx.db.query("households").collect();
    let dispatched = 0;

    for (const household of households) {
      const prefs = await ctx.db
        .query("householdPreferences")
        .withIndex("by_household", (q) => q.eq("householdId", household._id))
        .unique();
      if (!prefs) continue;

      const match = matchRecall(recall, prefs);
      const members = await ctx.db
        .query("members")
        .withIndex("by_household", (q) => q.eq("householdId", household._id))
        .collect();

      for (const member of members) {
        const settings = await ctx.db
          .query("notificationSettings")
          .withIndex("by_member", (q) => q.eq("memberId", member._id))
          .unique();
        // No channel opted in → no notification on any path below.
        if (!settings || (!settings.emailOptIn && !settings.pushOptIn)) continue;

        if (event === "closure") {
          // A now-closed recall must never announce itself as new: drop any
          // still-pending match line for it first.
          const rows = await queueRowsFor(ctx, member._id, recallId);
          for (const r of rows.filter((r) => r.kind === "match")) {
            await ctx.db.delete(r._id);
          }
          // Closure lines are an email-digest concept only (push never
          // fires for closures — see the module header); go only to members
          // previously emailed for this alert, and only while the category
          // stays enabled (absolute gate §7).
          if (!settings.emailOptIn || !match.categoryEnabled) continue;
          const priorSends = await ctx.db
            .query("notificationsSent")
            .withIndex("by_member_alert", (q) =>
              q
                .eq("memberId", member._id)
                .eq("alertId", recallId)
                .eq("channel", "email"),
            )
            .collect();
          if (priorSends.length === 0) continue; // never notified → timeline only
          await enqueueClosure(ctx, { memberId: member._id, recall, severity, now });
          dispatched++;
          continue;
        }

        if (!match.matched) continue; // national feed only, no notification

        const decision = decideRoute({
          match,
          severity,
          threshold: settings.urgencyThreshold,
        });

        if (decision.route === "instant") {
          if (
            settings.emailOptIn &&
            !(await hasSentRevision(ctx, member._id, recallId, recall.contentHash, "email"))
          ) {
            // Dedupe claim BEFORE the send (at-most-once): record, then schedule.
            await ctx.db.insert("notificationsSent", {
              memberId: member._id,
              alertId: recallId,
              alertType: "recall",
              contentHash: recall.contentHash,
              channel: "email",
              mode: "instant",
              sentAt: now,
            });
            const alert: InstantAlert = {
              title: recall.title,
              firm: recall.firm,
              severity,
              matchedOn: match.matchedOn,
              url: recallUrl(recallId),
            };
            const message: EmailMessage = {
              to: member.email,
              subject: instantSubject(alert),
              text: renderInstantText(
                alert,
                household.name,
                unsubscribeUrl(settings.unsubscribeToken),
              ),
            };
            await ctx.scheduler.runAfter(
              0,
              internal.notifications.sendInstantEmail,
              { message },
            );
            dispatched++;
          }

          if (
            settings.pushOptIn &&
            settings.pushSubscription &&
            !(await hasSentRevision(ctx, member._id, recallId, recall.contentHash, "push"))
          ) {
            await ctx.db.insert("notificationsSent", {
              memberId: member._id,
              alertId: recallId,
              alertType: "recall",
              contentHash: recall.contentHash,
              channel: "push",
              mode: "instant",
              sentAt: now,
            });
            const payload = renderPushPayload({
              title: recall.title,
              severity,
              url: recallUrl(recallId),
              tag: recallId,
            });
            await ctx.scheduler.runAfter(0, internal.push.sendPushNotification, {
              memberId: member._id,
              subscription: settings.pushSubscription,
              payload,
            });
            dispatched++;
          }
        } else if (decision.route === "digest" && settings.emailOptIn) {
          // The email digest is the sole "quiet" channel — push is
          // instant-only and simply doesn't fire below its threshold.
          await enqueueMatch(ctx, {
            memberId: member._id,
            recall,
            match,
            severity,
            now,
          });
          dispatched++;
        }
      }
    }

    return { dispatched };
  },
});

// ---------------------------------------------------------------------------
// Source status for the digest footer / reassurance gate (§10). Mirrors
// sourceHealth.getPublicStatus: read-time staleness recompute, worst-of stored
// vs. time-based, so a dead scheduler can never leave the gate green.
// ---------------------------------------------------------------------------

const STATE_RANK: Record<HealthState, number> = {
  current: 0,
  delayed: 1,
  unavailable: 2,
};

async function computeSourceStatus(ctx: MutationCtx, now: number) {
  const all = await ctx.db.query("sourceHealth").collect();
  const sources = all.map((s) => {
    const timeBased = computeHealthState({
      source: s.source,
      now,
      lastSuccessAt: s.lastSuccessAt,
      consecutiveFailures: s.consecutiveFailures,
      anomaly: false,
    });
    const state: HealthState =
      STATE_RANK[timeBased] > STATE_RANK[s.state] ? timeBased : s.state;
    return { source: s.source, state, lastSuccessAt: s.lastSuccessAt };
  });
  return {
    sources,
    allCurrent: sources.length > 0 && sources.every((s) => s.state === "current"),
  };
}

/**
 * Build every due member's digest, drain their queue, and record the sends —
 * all in one transaction so a replay can't double-send. Returns the composed
 * messages for the action to deliver. An empty queue still produces a message:
 * the empty digest is the trust mechanism (§9), with reassurance vs.
 * incompleteness copy gated by source health (§10). `now` is injectable for
 * deterministic tests.
 */
export const drainDueDigests = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ messages: EmailMessage[] }> => {
    const now = args.now ?? Date.now();
    const status = await computeSourceStatus(ctx, now);
    const allSettings = await ctx.db.query("notificationSettings").collect();
    const messages: EmailMessage[] = [];

    for (const settings of allSettings) {
      if (!settings.digestEnabled || !settings.emailOptIn) continue;
      if (
        !isDigestDue({
          now,
          timezone: settings.timezone,
          digestHour: settings.digestHour,
          lastDigestAt: settings.lastDigestAt,
        })
      ) {
        continue;
      }

      const member = await ctx.db.get(settings.memberId);
      if (!member) continue;
      const household = await ctx.db.get(member.householdId);
      const householdName = household?.name ?? "your household";

      const queueRows = await ctx.db
        .query("digestQueue")
        .withIndex("by_member", (q) => q.eq("memberId", settings.memberId))
        .collect();

      const items: DigestItem[] = [];
      for (const row of queueRows) {
        const recall = await ctx.db.get(row.alertId as Id<"recalls">);
        if (!recall) continue; // recall vanished → drop the line
        if (row.kind === "closure") {
          if (recall.lifecycle === "active") continue; // reopened → stale closure
          items.push({
            kind: "closure",
            title: recall.title,
            lifecycle: recall.lifecycle,
            url: recallUrl(row.alertId),
          });
        } else {
          items.push({
            kind: "match",
            title: recall.title,
            firm: recall.firm,
            severity: row.severity,
            matchedOn: row.matchedOn as MatchDimension[],
            confidence: row.confidence,
            url: recallUrl(row.alertId),
          });
        }
      }

      const input: DigestInput = {
        householdName,
        items,
        allSourcesCurrent: status.allCurrent,
        sources: status.sources,
        now,
        unsubscribeUrl: unsubscribeUrl(settings.unsubscribeToken),
      };
      messages.push({
        to: member.email,
        subject: digestSubject(input),
        text: renderDigestText(input),
      });

      // Log matched sends so a later revision can still notify but this one
      // won't repeat; closures are informational and aren't logged.
      for (const row of queueRows) {
        if (row.kind !== "match") continue;
        await ctx.db.insert("notificationsSent", {
          memberId: settings.memberId,
          alertId: row.alertId,
          alertType: row.alertType,
          contentHash: row.contentHash,
          channel: "email",
          mode: "digest",
          sentAt: now,
        });
      }
      for (const row of queueRows) await ctx.db.delete(row._id);
      await ctx.db.patch(settings._id, { lastDigestAt: now });
    }

    return { messages };
  },
});

// ---------------------------------------------------------------------------
// Delivery actions. Kept thin: all matching / dedupe / queue writes happen in
// the mutations above; these only talk to Resend.
// ---------------------------------------------------------------------------

const emailMessageValidator = v.object({
  to: v.string(),
  subject: v.string(),
  text: v.string(),
});

export const sendInstantEmail = internalAction({
  args: { message: emailMessageValidator },
  handler: async (_ctx, { message }) => {
    const result = await sendEmail(message);
    if (!result.ok) {
      console.error(`[instant] send failed to ${message.to}: ${result.error}`);
    }
    return result;
  },
});

/** Hourly cron target (§9 digest). Drains due members, then delivers. */
export const sendDigests = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const { messages } = await ctx.runMutation(
      internal.notifications.drainDueDigests,
      {},
    );
    for (const message of messages) {
      const result = await sendEmail(message);
      if (!result.ok) {
        console.error(`[digest] send failed to ${message.to}: ${result.error}`);
      }
    }
    return { sent: messages.length };
  },
});

/**
 * Operator self-alert when a source degrades (§10). Scheduled by
 * sourceHealth.reportRun on a current → delayed/unavailable transition. Skips
 * (with a log) when OPERATOR_EMAIL is unset.
 */
export const sendOperatorAlert = internalAction({
  args: {
    source: v.string(),
    previousState: v.string(),
    state: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const to = process.env.OPERATOR_EMAIL;
    if (!to) {
      console.warn(
        "[operator] OPERATOR_EMAIL unset — skipping degradation alert for " +
          args.source,
      );
      return { ok: true as const, skipped: true };
    }
    const message: EmailMessage = {
      to,
      subject: `[Food Recalls] source ${args.source} degraded → ${args.state}`,
      text:
        `Source "${args.source}" changed health: ${args.previousState} → ${args.state}.` +
        (args.error ? `\nLast error: ${args.error}` : "") +
        `\n\nPer the §10 data-health contract, all-clear reassurance copy is now ` +
        `suppressed until this source is Current again.`,
    };
    const result = await sendEmail(message);
    if (!result.ok) console.error(`[operator] send failed: ${result.error}`);
    return result;
  },
});
