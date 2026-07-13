import { query } from "./_generated/server";
import { v } from "convex/values";
import { requirePilotSecret } from "./lib/access";
import { buildHouseholdSummary } from "./lib/summary";

// Read-only Household tab (SPEC.md §12 nav item 4 / §11 Step 5 recap).
// Gated by a shared pilot secret (§2) — never publicly queryable.

type Preset = "recommended" | "everything" | "digest_only";

/**
 * The questionnaire's chosen preset isn't persisted verbatim (only its
 * resolved `notificationSettings` are) — see `PRESET_SETTINGS` in seed.ts.
 * Reverse-infer for display; every seed-generated record fits one of the
 * three cases exactly. A Phase-5 UI that lets members hand-edit settings
 * independently of a preset would need to store the choice directly.
 */
function inferPresetLabel(threshold: "class1_only" | "class1_plus_allergen" | "everything"): Preset {
  switch (threshold) {
    case "everything":
      return "everything";
    case "class1_only":
      return "digest_only";
    case "class1_plus_allergen":
      return "recommended";
  }
}

export const getPilotSummary = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requirePilotSecret(args.secret);

    const household = await ctx.db.query("households").first();
    if (!household) return null;

    const preferences = await ctx.db
      .query("householdPreferences")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .unique();
    if (!preferences) return null;

    const members = await ctx.db
      .query("members")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect();

    let preset: Preset = "recommended";
    let pushEnabled = false;
    const firstMember = members[0];
    if (firstMember) {
      const settings = await ctx.db
        .query("notificationSettings")
        .withIndex("by_member", (q) => q.eq("memberId", firstMember._id))
        .unique();
      if (settings) {
        preset = inferPresetLabel(settings.urgencyThreshold);
        pushEnabled = settings.pushOptIn;
      }
    }

    const summary = buildHouseholdSummary({
      states: preferences.states,
      allergens: preferences.allergens,
      pets: preferences.pets,
      members: preferences.members,
      preset,
    });

    return {
      householdName: household.name,
      summary,
      states: preferences.states,
      chains: preferences.chains,
      allergens: preferences.allergens,
      categories: preferences.categories,
      pets: preferences.pets,
      members: preferences.members,
      preset,
      pushEnabled,
    };
  },
});
