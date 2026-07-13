import { internalMutation } from "./_generated/server";
import { newToken } from "./lib/members";

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
