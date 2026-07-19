import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// Press-image mirroring (SPEC.md §15). Press-release / Open Food Facts image
// URLs rot; mirror the image into Convex file storage for alerts a household
// cares about — bookmarked (bookmarks.toggle) and matched (notification
// dispatch). On success `imageUrl` is rewritten to the durable storage URL and
// `imageStorageId` is set (both the "already mirrored" marker and the durable
// reference); `imageSource` keeps the original provenance. Every step is a
// no-op when there's nothing to do, so the trigger points can fire freely.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB — recall photos are far smaller

async function fetchImageBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) return null;
    return blob;
  } catch {
    return null; // network/DNS failure — the hotlink stays as-is, try again later
  }
}

// --- recalls ---------------------------------------------------------------

export const recallImageState = internalQuery({
  args: { recallId: v.id("recalls") },
  handler: async (ctx, { recallId }) => {
    const r = await ctx.db.get(recallId);
    if (!r) return null;
    return { imageUrl: r.imageUrl, imageStorageId: r.imageStorageId };
  },
});

export const setRecallMirror = internalMutation({
  args: { recallId: v.id("recalls"), storageId: v.id("_storage"), url: v.string() },
  handler: async (ctx, { recallId, storageId, url }) => {
    const r = await ctx.db.get(recallId);
    // Lost a race with a concurrent mirror (or the recall vanished): drop the
    // duplicate blob rather than orphan it.
    if (!r || r.imageStorageId) {
      await ctx.storage.delete(storageId);
      return;
    }
    await ctx.db.patch(recallId, {
      imageUrl: url,
      imageStorageId: storageId,
      updatedAt: Date.now(),
    });
  },
});

export const mirrorRecallImage = internalAction({
  args: { recallId: v.id("recalls") },
  handler: async (ctx, { recallId }): Promise<{ mirrored: boolean }> => {
    const state = await ctx.runQuery(internal.images.recallImageState, { recallId });
    if (!state || !state.imageUrl || state.imageStorageId) return { mirrored: false };
    const blob = await fetchImageBlob(state.imageUrl);
    if (!blob) return { mirrored: false };
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      await ctx.storage.delete(storageId);
      return { mirrored: false };
    }
    await ctx.runMutation(internal.images.setRecallMirror, { recallId, storageId, url });
    return { mirrored: true };
  },
});

// --- outbreaks -------------------------------------------------------------

export const outbreakImageState = internalQuery({
  args: { outbreakId: v.id("outbreaks") },
  handler: async (ctx, { outbreakId }) => {
    const o = await ctx.db.get(outbreakId);
    if (!o) return null;
    return { imageUrl: o.imageUrl, imageStorageId: o.imageStorageId };
  },
});

export const setOutbreakMirror = internalMutation({
  args: { outbreakId: v.id("outbreaks"), storageId: v.id("_storage"), url: v.string() },
  handler: async (ctx, { outbreakId, storageId, url }) => {
    const o = await ctx.db.get(outbreakId);
    if (!o || o.imageStorageId) {
      await ctx.storage.delete(storageId);
      return;
    }
    await ctx.db.patch(outbreakId, {
      imageUrl: url,
      imageStorageId: storageId,
      updatedAt: Date.now(),
    });
  },
});

export const mirrorOutbreakImage = internalAction({
  args: { outbreakId: v.id("outbreaks") },
  handler: async (ctx, { outbreakId }): Promise<{ mirrored: boolean }> => {
    const state = await ctx.runQuery(internal.images.outbreakImageState, { outbreakId });
    if (!state || !state.imageUrl || state.imageStorageId) return { mirrored: false };
    const blob = await fetchImageBlob(state.imageUrl);
    if (!blob) return { mirrored: false };
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      await ctx.storage.delete(storageId);
      return { mirrored: false };
    }
    await ctx.runMutation(internal.images.setOutbreakMirror, { outbreakId, storageId, url });
    return { mirrored: true };
  },
});

// --- one-off backfill for already-bookmarked alerts (§15) ------------------

export const backfillBookmarkedImages = internalAction({
  args: {},
  handler: async (ctx): Promise<{ recalls: number; outbreaks: number }> => {
    const bookmarks = await ctx.runQuery(internal.images.allBookmarkTargets, {});
    let recalls = 0;
    let outbreaks = 0;
    for (const b of bookmarks) {
      if (b.alertType === "recall") {
        await ctx.runAction(internal.images.mirrorRecallImage, {
          recallId: b.alertId as Id<"recalls">,
        });
        recalls++;
      } else {
        await ctx.runAction(internal.images.mirrorOutbreakImage, {
          outbreakId: b.alertId as Id<"outbreaks">,
        });
        outbreaks++;
      }
    }
    return { recalls, outbreaks };
  },
});

export const allBookmarkTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const bookmarks = await ctx.db.query("bookmarks").collect();
    // De-dupe by alertId — many members may bookmark the same alert.
    const seen = new Set<string>();
    const out: Array<{ alertId: string; alertType: "recall" | "outbreak" }> = [];
    for (const b of bookmarks) {
      if (seen.has(b.alertId)) continue;
      seen.add(b.alertId);
      out.push({ alertId: b.alertId, alertType: b.alertType });
    }
    return out;
  },
});
