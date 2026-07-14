import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { newToken } from "./lib/members";
import { buildRecallSearchText, buildOutbreakSearchText } from "./lib/search";

// One-off backfill for rows created before Phase 5 (SPEC.md §2). The pilot
// household's member(s) predate the `role` field and its notificationSettings
// predate `unsubscribeToken`; both are now optional in the schema so the push
// succeeded, and this fills them in. Idempotent — safe to run repeatedly.
//
//   npx convex run migrations:migratePilotMembers
export const migratePilotMembers = internalMutation({
  args: {},
  handler: async (ctx) => {
    let membersFixed = 0;
    let tokensFixed = 0;

    const households = await ctx.db.query("households").collect();
    for (const household of households) {
      const members = await ctx.db
        .query("members")
        .withIndex("by_household", (q) => q.eq("householdId", household._id))
        .collect();
      const alreadyHasOwner = members.some((m) => m.role === "owner");
      let ownerAssigned = alreadyHasOwner;
      for (const member of members) {
        if (member.role) continue;
        const role = ownerAssigned ? ("member" as const) : ("owner" as const);
        ownerAssigned = true;
        await ctx.db.patch(member._id, { role });
        membersFixed++;
      }
    }

    const allSettings = await ctx.db.query("notificationSettings").collect();
    for (const settings of allSettings) {
      if (settings.unsubscribeToken) continue;
      await ctx.db.patch(settings._id, { unsubscribeToken: newToken() });
      tokensFixed++;
    }

    return { membersFixed, tokensFixed };
  },
});

// One-off backfill of the denormalized `searchText` field (§10 search + scanner
// UPC checks) onto rows created before the field existed. New/updated rows get
// it from the upsert paths (convex/recalls.ts, convex/outbreaks.ts); this fills
// the ~29k historical recalls (and any outbreaks) already in the table. Each
// `*Page` mutation processes one bounded page so it stays under Convex's
// per-transaction read limit; the `run*` action drives the cursor to completion
// in a single blocking call, so `npx convex run` returns the total updated
// rather than fire-and-forgetting a chain of scheduled continuations.
//
//   npx convex run migrations:runRecallSearchBackfill
//   npx convex run migrations:runOutbreakSearchBackfill
const SEARCH_BACKFILL_PAGE = 100;

export const backfillRecallSearchPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ updated: number; isDone: boolean; cursor: string }> => {
    const page = await ctx.db
      .query("recalls")
      .paginate({ cursor: args.cursor, numItems: SEARCH_BACKFILL_PAGE });
    let updated = 0;
    for (const doc of page.page) {
      const searchText = buildRecallSearchText(doc);
      if (doc.searchText !== searchText) {
        await ctx.db.patch(doc._id, { searchText });
        updated++;
      }
    }
    return { updated, isDone: page.isDone, cursor: page.continueCursor };
  },
});

export const runRecallSearchBackfill = internalAction({
  args: {},
  handler: async (ctx): Promise<{ updated: number }> => {
    let cursor: string | null = null;
    let updated = 0;
    for (;;) {
      const res: { updated: number; isDone: boolean; cursor: string } =
        await ctx.runMutation(internal.migrations.backfillRecallSearchPage, { cursor });
      updated += res.updated;
      if (res.isDone) break;
      cursor = res.cursor;
    }
    return { updated };
  },
});

export const backfillOutbreakSearchPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ updated: number; isDone: boolean; cursor: string }> => {
    const page = await ctx.db
      .query("outbreaks")
      .paginate({ cursor: args.cursor, numItems: SEARCH_BACKFILL_PAGE });
    let updated = 0;
    for (const doc of page.page) {
      const searchText = buildOutbreakSearchText(doc);
      if (doc.searchText !== searchText) {
        await ctx.db.patch(doc._id, { searchText });
        updated++;
      }
    }
    return { updated, isDone: page.isDone, cursor: page.continueCursor };
  },
});

export const runOutbreakSearchBackfill = internalAction({
  args: {},
  handler: async (ctx): Promise<{ updated: number }> => {
    let cursor: string | null = null;
    let updated = 0;
    for (;;) {
      const res: { updated: number; isDone: boolean; cursor: string } =
        await ctx.runMutation(internal.migrations.backfillOutbreakSearchPage, { cursor });
      updated += res.updated;
      if (res.isDone) break;
      cursor = res.cursor;
    }
    return { updated };
  },
});
