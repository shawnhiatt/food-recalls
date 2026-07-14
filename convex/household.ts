import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  currentUserId,
  getCurrentMember,
  requireHousehold,
  requireMember,
  requireOwner,
  requireUserId,
} from "./lib/auth";
import { buildHouseholdSummary } from "./lib/summary";
import {
  ageBandValidator,
  preferencesFromQuestionnaire,
  PRESET_SETTINGS,
  questionnaireValidator,
  type PresetName,
} from "./lib/onboarding";
import { createMemberWithSettings, deleteAuthUser } from "./lib/members";

// The authenticated Household tab + onboarding API (SPEC.md §11, §12 nav 4).
// Replaces the pilot secret gate (lib/access.ts) with per-household
// authorization (lib/auth.ts): every function reads or writes only the caller's
// own household, resolved from their auth user's member row.

type Preset = PresetName;

/**
 * The questionnaire's preset isn't persisted verbatim; reverse-infer it from
 * the owner's resolved notificationSettings for display. A Phase-5 UI that lets
 * members hand-edit threshold + digest independently could desync from any
 * preset, so treat this as best-effort labelling for the recap only.
 */
function inferPresetLabel(
  threshold: "class1_only" | "class1_plus_allergen" | "everything",
): Preset {
  switch (threshold) {
    case "everything":
      return "everything";
    case "class1_only":
      return "digest_only";
    case "class1_plus_allergen":
      return "recommended";
  }
}

async function ownerSettings(
  ctx: Parameters<typeof getCurrentMember>[0],
  householdId: Id<"households">,
): Promise<Doc<"notificationSettings"> | null> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
  const owner = members.find((m) => m.role === "owner") ?? members[0];
  if (!owner) return null;
  return await ctx.db
    .query("notificationSettings")
    .withIndex("by_member", (q) => q.eq("memberId", owner._id))
    .unique();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Routing/gating signal for the app shell: is the caller signed in, and do they
 * have a household yet (or need onboarding)? Cheap and safe to call anywhere.
 */
export const getMyContext = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) {
      return { signedIn: false, hasHousehold: false, needsOnboarding: false } as const;
    }
    const member = await getCurrentMember(ctx);
    if (!member) {
      return { signedIn: true, hasHousehold: false, needsOnboarding: true } as const;
    }
    const household = await ctx.db.get(member.householdId);
    return {
      signedIn: true,
      hasHousehold: true,
      needsOnboarding: false,
      role: member.role ?? "member",
      email: member.email,
      householdName: household?.name ?? null,
    } as const;
  },
});

/** The §11 Step-5 recap + preferences for the Household tab. Null if no household. */
export const getMySummary = query({
  args: {},
  handler: async (ctx) => {
    const member = await getCurrentMember(ctx);
    if (!member) return null;
    const household = await ctx.db.get(member.householdId);
    if (!household) return null;

    const preferences = await ctx.db
      .query("householdPreferences")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .unique();
    if (!preferences) return null;

    const settings = await ownerSettings(ctx, household._id);
    const preset = settings ? inferPresetLabel(settings.urgencyThreshold) : "recommended";
    const pushEnabled = settings?.pushOptIn ?? false;

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
      brands: preferences.brands,
      keywords: preferences.keywords,
      allergens: preferences.allergens,
      categories: preferences.categories,
      pets: preferences.pets,
      members: preferences.members,
      preset,
      pushEnabled,
      role: member.role ?? "member",
    };
  },
});

/** Full editable preferences (edit forms + "Redo setup" prefill). */
export const getMyPreferences = query({
  args: {},
  handler: async (ctx) => {
    const member = await getCurrentMember(ctx);
    if (!member) return null;
    const preferences = await ctx.db
      .query("householdPreferences")
      .withIndex("by_household", (q) => q.eq("householdId", member.householdId))
      .unique();
    const household = await ctx.db.get(member.householdId);
    if (!preferences || !household) return null;
    return { householdName: household.name, ...stripSystemFields(preferences) };
  },
});

/** The caller's own notification settings (per-member, §9). */
export const getMyNotificationSettings = query({
  args: {},
  handler: async (ctx) => {
    const member = await getCurrentMember(ctx);
    if (!member) return null;
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .unique();
    if (!settings) return null;
    return {
      emailOptIn: settings.emailOptIn,
      pushOptIn: settings.pushOptIn,
      hasPushSubscription: settings.pushSubscription !== undefined,
      urgencyThreshold: settings.urgencyThreshold,
      digestEnabled: settings.digestEnabled,
      digestHour: settings.digestHour,
      preset: inferPresetLabel(settings.urgencyThreshold),
    };
  },
});

/** Household accounts (members table) + pending invites — owner-facing. */
export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const { household, member } = await requireHousehold(ctx);
    const members = await ctx.db
      .query("members")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect();
    return members.map((m) => ({
      email: m.email,
      role: m.role ?? "member",
      linked: m.authUserId !== undefined,
      isSelf: m._id === member._id,
    }));
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * First-run onboarding (SPEC.md §11). The signed-in user has no member yet;
 * create their household, preferences, and an owner member bound to them. The
 * owner's email comes from their verified auth identity, not user input.
 */
export const completeOnboarding = mutation({
  args: { answers: questionnaireValidator },
  handler: async (ctx, { answers }) => {
    const userId = await requireUserId(ctx);
    const existing = await getCurrentMember(ctx);
    if (existing) {
      throw new ConvexError({
        code: "already_onboarded",
        message: "This account already belongs to a household.",
      });
    }

    const user = await ctx.db.get(userId);
    const email = typeof user?.email === "string" ? user.email : answers.householdName;

    const now = Date.now();
    const householdId = await ctx.db.insert("households", {
      name: answers.householdName,
      onboardingCompletedAt: now,
    });
    const preferences = preferencesFromQuestionnaire(answers);
    await ctx.db.insert("householdPreferences", { householdId, ...preferences });
    await createMemberWithSettings(ctx, {
      householdId,
      email,
      role: "owner",
      authUserId: userId,
      preset: answers.notifications.preset,
      timezone: answers.notifications.timezone,
    });

    return { householdId };
  },
});

const preferencePatchValidator = {
  householdName: v.optional(v.string()),
  states: v.optional(v.array(v.string())),
  brands: v.optional(v.array(v.string())),
  keywords: v.optional(v.array(v.string())),
  chains: v.optional(v.array(v.string())),
  allergens: v.optional(v.array(v.string())),
  categories: v.optional(
    v.object({
      humanFood: v.boolean(),
      petFood: v.boolean(),
      outbreaks: v.boolean(),
    }),
  ),
  pets: v.optional(v.array(v.union(v.literal("dog"), v.literal("cat"), v.literal("other")))),
  members: v.optional(
    v.array(
      v.object({
        label: v.string(),
        labelPinned: v.boolean(),
        ageBand: ageBandValidator,
        pregnant: v.optional(v.boolean()),
        immunocompromised: v.optional(v.boolean()),
      }),
    ),
  ),
};

/**
 * Edit household preferences from the Household tab. Preference changes
 * re-rank the feed automatically (the matcher runs live in feed queries) but
 * NEVER retroactively notify (§7, §17.11) — this mutation deliberately
 * schedules no dispatch. Any household member may edit shared preferences.
 */
export const updatePreferences = mutation({
  args: preferencePatchValidator,
  handler: async (ctx, args) => {
    const { member, household } = await requireHousehold(ctx);
    const preferences = await ctx.db
      .query("householdPreferences")
      .withIndex("by_household", (q) => q.eq("householdId", member.householdId))
      .unique();
    if (!preferences) throw new ConvexError({ code: "no_household" });

    const { householdName, ...prefPatch } = args;
    const cleaned = Object.fromEntries(
      Object.entries(prefPatch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(cleaned).length > 0) {
      await ctx.db.patch(preferences._id, cleaned);
    }
    if (householdName !== undefined && householdName.trim()) {
      await ctx.db.patch(household._id, { name: householdName.trim() });
    }
    return { ok: true as const };
  },
});

/**
 * "Redo setup" (SPEC.md §11) — re-run the whole questionnaire, overwriting
 * preferences and the owner's notification preset. Owner-only, since it resets
 * shared household config wholesale. Never re-notifies (§17.11).
 */
export const redoSetup = mutation({
  args: { answers: questionnaireValidator },
  handler: async (ctx, { answers }) => {
    const { household, member } = await requireOwner(ctx);
    const preferences = await ctx.db
      .query("householdPreferences")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .unique();
    if (!preferences) throw new ConvexError({ code: "no_household" });

    await ctx.db.patch(preferences._id, preferencesFromQuestionnaire(answers));
    if (answers.householdName.trim()) {
      await ctx.db.patch(household._id, { name: answers.householdName.trim() });
    }

    // Reset the owner's own notification preset/timezone (other members keep
    // their independent settings).
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .unique();
    if (settings) {
      const preset = PRESET_SETTINGS[answers.notifications.preset];
      await ctx.db.patch(settings._id, {
        urgencyThreshold: preset.urgencyThreshold,
        digestEnabled: preset.digestEnabled,
        timezone: answers.notifications.timezone,
      });
    }
    return { ok: true as const };
  },
});

/** Update the caller's own notification settings (§9 three knobs). */
export const updateNotificationSettings = mutation({
  args: {
    preset: v.optional(
      v.union(v.literal("recommended"), v.literal("everything"), v.literal("digest_only")),
    ),
    emailOptIn: v.optional(v.boolean()),
    digestHour: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .unique();
    if (!settings) throw new ConvexError({ code: "no_settings" });

    const patch: Partial<Doc<"notificationSettings">> = {};
    if (args.preset) {
      const preset = PRESET_SETTINGS[args.preset];
      patch.urgencyThreshold = preset.urgencyThreshold;
      patch.digestEnabled = preset.digestEnabled;
    }
    if (args.emailOptIn !== undefined) patch.emailOptIn = args.emailOptIn;
    if (args.digestHour !== undefined) {
      patch.digestHour = Math.max(0, Math.min(23, Math.floor(args.digestHour)));
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(settings._id, patch);
    return { ok: true as const };
  },
});

/**
 * Full data export (SPEC.md §2). Returns everything the household holds about
 * the caller and their household as a plain JSON object.
 */
export const exportData = query({
  args: {},
  handler: async (ctx) => {
    const { member, household } = await requireHousehold(ctx);
    const preferences = await ctx.db
      .query("householdPreferences")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .unique();
    const members = await ctx.db
      .query("members")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect();
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .unique();
    const bookmarks = await ctx.db
      .query("bookmarks")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .collect();
    const pantryItems = await ctx.db
      .query("pantryItems")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect();

    return {
      exportedAt: new Date().toISOString(),
      household: { name: household.name, onboardingCompletedAt: household.onboardingCompletedAt },
      preferences: preferences ? stripSystemFields(preferences) : null,
      accounts: members.map((m) => ({ email: m.email, role: m.role ?? "member" })),
      myNotificationSettings: settings
        ? {
            emailOptIn: settings.emailOptIn,
            pushOptIn: settings.pushOptIn,
            urgencyThreshold: settings.urgencyThreshold,
            digestEnabled: settings.digestEnabled,
            digestHour: settings.digestHour,
            timezone: settings.timezone,
          }
        : null,
      myBookmarks: bookmarks.map((b) => ({
        alertId: b.alertId,
        alertType: b.alertType,
        createdAt: b.createdAt,
      })),
      pantry: pantryItems.map((p) => ({
        upc: p.upc,
        productName: p.productName,
        brand: p.brand,
        scannedAt: p.scannedAt,
      })),
    };
  },
});

/**
 * Delete the caller's account (SPEC.md §2). Removes the caller's member row and
 * all member-scoped data. If they were the household's last account, the
 * household + shared preferences + invites are deleted too. Finally deletes the
 * auth user so the identity is fully gone.
 */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const member = await getCurrentMember(ctx);
    if (!member) {
      // Signed in but never onboarded — just delete the auth user.
      await deleteAuthUser(ctx, userId);
      return { deletedHousehold: false as const };
    }

    // Member-scoped data. bookmarks + digestQueue index on by_member;
    // notificationsSent's index is by_member_alert (memberId is its prefix).
    for (const table of ["bookmarks", "digestQueue"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_member", (q) => q.eq("memberId", member._id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    const sentRows = await ctx.db
      .query("notificationsSent")
      .withIndex("by_member_alert", (q) => q.eq("memberId", member._id))
      .collect();
    for (const row of sentRows) await ctx.db.delete(row._id);
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .unique();
    if (settings) await ctx.db.delete(settings._id);

    const householdId = member.householdId;
    await ctx.db.delete(member._id);

    // If no accounts remain, tear down the shared household.
    const remaining = await ctx.db
      .query("members")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    let deletedHousehold = false;
    if (remaining.length === 0) {
      const prefs = await ctx.db
        .query("householdPreferences")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .unique();
      if (prefs) await ctx.db.delete(prefs._id);
      const invites = await ctx.db
        .query("invites")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect();
      for (const invite of invites) await ctx.db.delete(invite._id);
      const pantryItems = await ctx.db
        .query("pantryItems")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect();
      for (const item of pantryItems) await ctx.db.delete(item._id);
      await ctx.db.delete(householdId);
      deletedHousehold = true;
    }

    await deleteAuthUser(ctx, userId);
    return { deletedHousehold };
  },
});

/** Drop Convex system fields from a document before returning it to a client. */
function stripSystemFields<T extends { _id: unknown; _creationTime: unknown }>(doc: T) {
  const { _id, _creationTime, ...rest } = doc;
  void _id;
  void _creationTime;
  return rest;
}
