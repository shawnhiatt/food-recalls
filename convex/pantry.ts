import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getCurrentMember, requireHousehold } from "./lib/auth";
import { matchPantryItem, type PantryMatch, type PantryMatchableRecall } from "./lib/pantry";

// Scanner & pantry (SPEC.md §12 Scanner tab, §7 pantry dimension, Phase 7).
// Every scan is persisted to `pantryItems` — the single table doubles as
// "scan history" and current pantry contents (the schema, §6, models only
// one table; a user removes items they've used up via `remove`). §3's
// fallback chain: exact UPC match against active recalls' productCodes
// first (high confidence); only when that misses do we look up the
// product's brand (Open Food Facts, by UPC — same source Phase 1 already
// uses for images) and soft-match it against recall firms ("same
// manufacturer has other active recalls," possible confidence). A scan that
// matches neither is "no known recall" — never "safe" (§3).

const ACTIVE_SCAN_LIMIT = 2000; // bounded, same 16MB-budget concern as feed.ts

async function activeRecalls(ctx: QueryCtx): Promise<PantryMatchableRecall[]> {
  const docs = await ctx.db
    .query("recalls")
    .withIndex("by_lifecycle", (q) => q.eq("lifecycle", "active"))
    .take(ACTIVE_SCAN_LIMIT);
  return docs.map((r) => ({ _id: r._id, productCodes: r.productCodes, firm: r.firm }));
}

async function recallSummaries(
  ctx: QueryCtx,
  ids: string[],
): Promise<Array<{ _id: Id<"recalls">; title: string; firm: string }>> {
  const docs = await Promise.all(ids.map((id) => ctx.db.get(id as Id<"recalls">)));
  return docs
    .filter((d): d is Doc<"recalls"> => d !== null)
    .map((d) => ({ _id: d._id, title: d.title, firm: d.firm }));
}

/** Internal: match one (upc, brand?) against currently-active recalls. */
export const matchOne = internalQuery({
  args: { upc: v.string(), brand: v.optional(v.string()) },
  handler: async (ctx, args): Promise<PantryMatch> => {
    const active = await activeRecalls(ctx);
    return matchPantryItem({ upc: args.upc, brand: args.brand }, active);
  },
});

/** Internal: persist one scan to the caller's household pantry. */
export const recordScan = internalMutation({
  args: {
    upc: v.string(),
    productName: v.optional(v.string()),
    brand: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"pantryItems">> => {
    const { household } = await requireHousehold(ctx);
    return await ctx.db.insert("pantryItems", {
      householdId: household._id,
      upc: args.upc,
      productName: args.productName,
      brand: args.brand,
      scannedAt: Date.now(),
    });
  },
});

const OFF_URL = "https://world.openfoodfacts.org/api/v2/product";
const HEADERS = { "User-Agent": "FoodRecalls/0.1 (personal household pilot)" };

/** Open Food Facts product name/brand by UPC — same source as the Phase 1 image fallback. */
async function fetchOffProduct(upc: string): Promise<{ productName?: string; brand?: string } | null> {
  const response = await fetch(
    `${OFF_URL}/${encodeURIComponent(upc)}.json?fields=product_name,brands`,
    { headers: HEADERS },
  );
  if (!response.ok) return null; // 404 = unknown product, not an error
  const body = (await response.json()) as { product?: { product_name?: string; brands?: string } };
  if (!body.product) return null;
  // Open Food Facts' `brands` field is comma-separated; the first is primary.
  const brand = body.product.brands?.split(",")[0]?.trim();
  return { productName: body.product.product_name, brand: brand || undefined };
}

export type ScanResult = {
  status: "recall" | "same_manufacturer" | "no_known_recall";
  productName?: string;
  brand?: string;
  matchedRecalls: Array<{ _id: Id<"recalls">; title: string; firm: string }>;
  itemId: Id<"pantryItems">;
};

/**
 * Scan (or manually enter) a UPC: check for an exact recall match first
 * (cheap, no external call); only on a miss does it look up the product's
 * brand externally and try a same-manufacturer soft match. Always persists
 * the scan to the household's pantry (§13 "scan-to-pantry persistence").
 */
export const scanUpc = action({
  args: { upc: v.string() },
  handler: async (ctx, args): Promise<ScanResult> => {
    const upc = args.upc.trim();
    if (!upc) throw new ConvexError({ code: "invalid_upc", message: "Enter a barcode number." });

    const exact = await ctx.runQuery(internal.pantry.matchOne, { upc });
    if (exact.matched) {
      const itemId = await ctx.runMutation(internal.pantry.recordScan, { upc });
      const matchedRecalls = await ctx.runQuery(internal.pantry.summarize, { ids: exact.recallIds });
      return { status: "recall", matchedRecalls, itemId };
    }

    const off = await fetchOffProduct(upc).catch(() => null);
    const productName = off?.productName;
    const brand = off?.brand;

    const soft = brand ? await ctx.runQuery(internal.pantry.matchOne, { upc, brand }) : { matched: false as const };
    const itemId = await ctx.runMutation(internal.pantry.recordScan, { upc, productName, brand });

    if (soft.matched) {
      const matchedRecalls = await ctx.runQuery(internal.pantry.summarize, { ids: soft.recallIds });
      return { status: "same_manufacturer", productName, brand, matchedRecalls, itemId };
    }
    return { status: "no_known_recall", productName, brand, matchedRecalls: [], itemId };
  },
});

/** Internal: recall id -> {title, firm} for a scan result's matched list. */
export const summarize = internalQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => recallSummaries(ctx, args.ids),
});

/** The household's pantry / scan history, most recent first. Empty for signed-out visitors. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const member = await getCurrentMember(ctx);
    if (!member) return [];
    return await ctx.db
      .query("pantryItems")
      .withIndex("by_household", (q) => q.eq("householdId", member.householdId))
      .order("desc")
      .collect();
  },
});

export type PantryMatchEntry = {
  _id: Id<"pantryItems">;
  upc: string;
  productName?: string;
  brand?: string;
  scannedAt: number;
  matched: boolean;
  confidence?: "high" | "possible";
  matchedRecalls: Array<{ _id: Id<"recalls">; title: string; firm: string }>;
};

/**
 * Live pantry-vs-active-recalls matching (§7 pantry dimension, §14: "pantry
 * item auto-matches a subsequently ingested recall") — reactive, so a newly
 * ingested recall shows up here the moment `recalls.upsertBatch` commits, no
 * extra wiring needed. Empty for signed-out visitors.
 */
export const matches = query({
  args: {},
  handler: async (ctx): Promise<PantryMatchEntry[]> => {
    const member = await getCurrentMember(ctx);
    if (!member) return [];
    const items = await ctx.db
      .query("pantryItems")
      .withIndex("by_household", (q) => q.eq("householdId", member.householdId))
      .order("desc")
      .collect();
    if (items.length === 0) return [];

    const active = await activeRecalls(ctx); // one scan, reused for every item
    return await Promise.all(
      items.map(async (item) => {
        const result = matchPantryItem(item, active);
        const matchedRecalls = result.matched ? await recallSummaries(ctx, result.recallIds) : [];
        return {
          _id: item._id,
          upc: item.upc,
          productName: item.productName,
          brand: item.brand,
          scannedAt: item.scannedAt,
          matched: result.matched,
          confidence: result.matched ? result.confidence : undefined,
          matchedRecalls,
        };
      }),
    );
  },
});

/** Remove one pantry item (household-scoped — any member may edit the shared pantry). */
export const remove = mutation({
  args: { itemId: v.id("pantryItems") },
  handler: async (ctx, args) => {
    const { household } = await requireHousehold(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.householdId !== household._id) {
      throw new ConvexError({ code: "not_found", message: "Pantry item not found." });
    }
    await ctx.db.delete(args.itemId);
    return { ok: true as const };
  },
});
