import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setupConvex } from "./helpers";

// §15 press-image mirroring: fetch a bookmarked/matched alert's image and store
// it in Convex file storage, rewriting imageUrl to the durable storage URL while
// keeping imageSource provenance. The trigger points (bookmarks.toggle, dispatch)
// just schedule the action; here we exercise the action end-to-end with a
// stubbed fetch so no network is touched.

afterEach(() => vi.unstubAllGlobals());

function stubImageFetch(contentType = "image/jpeg", bytes = [1, 2, 3, 4]) {
  const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
      blob: async () => blob,
    })),
  );
}

async function insertRecall(
  t: ReturnType<typeof setupConvex>,
  imageUrl: string | undefined,
): Promise<Id<"recalls">> {
  return await t.run((ctx) =>
    ctx.db.insert("recalls", {
      source: "fda",
      sourceId: `R-${Math.random()}`,
      title: "Recall",
      firm: "Firm",
      classification: "Class II",
      rawStatus: "Ongoing",
      lifecycle: "active",
      recallDate: "2026-06-01",
      productDesc: "product",
      states: ["NC"],
      distribution: "NC",
      productCodes: [],
      allergens: [],
      audience: "human",
      hazardType: "other",
      riskGroups: [],
      imageUrl,
      imageSource: imageUrl ? "press" : undefined,
      sourceUrl: "https://example/recall",
      raw: {},
      contentHash: "hash-1",
      updateHistory: [],
      firstSeenAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

const getRecall = (t: ReturnType<typeof setupConvex>, id: Id<"recalls">) =>
  t.run((ctx) => ctx.db.get(id));

describe("mirrorRecallImage (§15)", () => {
  test("mirrors a hotlinked image into storage, rewriting imageUrl and keeping provenance", async () => {
    const t = setupConvex();
    stubImageFetch();
    const id = await insertRecall(t, "https://press.example/photo.jpg");

    const res = await t.action(internal.images.mirrorRecallImage, { recallId: id });
    expect(res).toEqual({ mirrored: true });

    const recall = await getRecall(t, id);
    expect(recall!.imageStorageId).toBeDefined();
    expect(recall!.imageUrl).not.toBe("https://press.example/photo.jpg"); // now a storage URL
    expect(recall!.imageSource).toBe("press"); // provenance preserved
  });

  test("is idempotent — a second run does not re-store", async () => {
    const t = setupConvex();
    stubImageFetch();
    const id = await insertRecall(t, "https://press.example/photo.jpg");

    await t.action(internal.images.mirrorRecallImage, { recallId: id });
    const afterFirst = await getRecall(t, id);

    const res = await t.action(internal.images.mirrorRecallImage, { recallId: id });
    expect(res).toEqual({ mirrored: false });
    const afterSecond = await getRecall(t, id);
    expect(afterSecond!.imageStorageId).toBe(afterFirst!.imageStorageId); // unchanged
  });

  test("no image → no-op", async () => {
    const t = setupConvex();
    stubImageFetch();
    const id = await insertRecall(t, undefined);

    const res = await t.action(internal.images.mirrorRecallImage, { recallId: id });
    expect(res).toEqual({ mirrored: false });
    expect((await getRecall(t, id))!.imageStorageId).toBeUndefined();
  });

  test("a non-image response is not mirrored", async () => {
    const t = setupConvex();
    stubImageFetch("text/html"); // e.g. the URL rotted into an error page
    const id = await insertRecall(t, "https://press.example/gone.jpg");

    const res = await t.action(internal.images.mirrorRecallImage, { recallId: id });
    expect(res).toEqual({ mirrored: false });
    expect((await getRecall(t, id))!.imageStorageId).toBeUndefined();
  });
});
