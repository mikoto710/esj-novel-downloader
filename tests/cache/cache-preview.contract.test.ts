// @vitest-environment jsdom

import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";

describe("cache preview and confirmed claims", () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
        const { clear } = await import("idb-keyval");
        await clear();
    });

    async function seedBook(imageEnabled = false) {
        const storage = await import("../../src/storage/cache/book-cache");
        await storage.claimBookCache("700", "previous-task", imageEnabled);
        await storage.putBookCacheBatchForTask(
            "700",
            "previous-task",
            new Map([
                [1, createChapter(1)],
                [7, createChapter(7)]
            ]),
            createCacheMeta({ bookId: "700", imageEnabled })
        );
        return storage;
    }

    it("reads only the manifest and chapter keys in one readonly snapshot", async () => {
        const storage = await seedBook();
        const get = vi.spyOn(IDBObjectStore.prototype, "get");
        const getAllKeys = vi.spyOn(IDBObjectStore.prototype, "getAllKeys");
        const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
        const put = vi.spyOn(IDBObjectStore.prototype, "put");
        const remove = vi.spyOn(IDBObjectStore.prototype, "delete");

        await expect(storage.previewBookCache("700", false)).resolves.toMatchObject({
            valid: true,
            size: 2,
            indexes: [1, 7],
            compatibility: "compatible",
            meta: { imageEnabled: false }
        });

        expect(get).toHaveBeenCalledExactlyOnceWith(["manifest", "700"]);
        expect(getAllKeys).toHaveBeenCalledOnce();
        expect(get.mock.contexts[0]).toBe(getAllKeys.mock.contexts[0]);
        expect(get.mock.contexts[0]).toHaveProperty("transaction.mode", "readonly");
        expect(getAll).not.toHaveBeenCalled();
        expect(put).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it("reports whole-book inventory even when its image settings cannot be reused", async () => {
        const storage = await seedBook();

        await expect(storage.previewBookCache("700", true)).resolves.toMatchObject({
            valid: true,
            size: 2,
            indexes: [1, 7],
            compatibility: "refetch-required"
        });
        await expect(storage.loadBookCache("700")).resolves.toMatchObject({ size: 2 });
    });

    it.each(["expired", "cleared"])("does not restore legacy records behind a %s v3 manifest", async (kind) => {
        const storage = await seedBook();
        const { set } = await import("idb-keyval");
        const ts = Date.now();
        if (kind === "cleared") {
            await storage.clearBookCacheForTask("700", "previous-task");
        } else {
            vi.spyOn(Date, "now").mockReturnValue(ts + 24 * 60 * 60 * 1000 + 1);
        }
        await set("esj_down_book_700", { ts: Date.now(), chapters: [[0, createChapter(0)]] });

        await expect(storage.previewBookCache("700", false)).resolves.toEqual({
            valid: false,
            size: 0,
            indexes: [],
            compatibility: "compatible"
        });
    });

    it("previews legacy data without migrating or removing it", async () => {
        const { get, set } = await import("idb-keyval");
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const legacy = { ts: Date.now(), chapters: [[3, createChapter(3)]] };
        await set("esj_down_book_700", legacy);

        await expect(storage.previewBookCache("700", false)).resolves.toMatchObject({
            valid: true,
            size: 1,
            indexes: [3],
            compatibility: "unknown"
        });
        expect(await get("esj_down_book_700")).toEqual(legacy);
        expect(await repository.readCacheManifestV3("700")).toBeUndefined();
    });

    it("requires confirmation without writes or a claimed event by default", async () => {
        const storage = await seedBook();
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const sync = await import("../../src/storage/cache/sync");
        const { get, set } = await import("idb-keyval");
        await expect(storage.previewBookCache("700", false)).resolves.toMatchObject({
            compatibility: "compatible"
        });
        await storage.putBookCacheBatchForTask(
            "700",
            "previous-task",
            new Map([[8, createChapter(8)]]),
            createCacheMeta({ bookId: "700", imageEnabled: true })
        );
        const legacy = { ts: Date.now(), chapters: [[0, createChapter(0)]] };
        await set("esj_down_book_700", legacy);
        const before = await repository.readCacheManifestV3("700");
        const publish = vi.spyOn(sync, "publishCacheSyncEvent");
        const put = vi.spyOn(IDBObjectStore.prototype, "put");
        const remove = vi.spyOn(IDBObjectStore.prototype, "delete");
        const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");

        await expect(storage.claimBookCache("700", "new-task", false)).resolves.toEqual({
            status: "needs-confirmation",
            valid: true,
            size: 3,
            indexes: [1, 7, 8],
            compatibility: "refetch-required",
            meta: before?.meta
        });

        expect(put).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(getAll).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(await repository.readCacheManifestV3("700")).toEqual(before);
        expect(await get("esj_down_book_700")).toEqual(legacy);
        expect((await storage.loadBookCache("700")).map?.size).toBe(3);
    });

    it("invalidates the whole book only after explicit confirmation", async () => {
        const storage = await seedBook();

        await expect(
            storage.claimBookCache("700", "new-task", true, undefined, { allowInvalidation: false })
        ).resolves.toMatchObject({ status: "needs-confirmation", size: 2 });
        await expect(
            storage.claimBookCache("700", "new-task", true, undefined, { allowInvalidation: true })
        ).resolves.toMatchObject({ status: "claimed", size: 0, map: null, invalidatedCount: 2 });
        await expect(storage.loadBookCache("700")).resolves.toMatchObject({ size: 0 });
        await expect(
            storage.putBookCacheBatchForTask("700", "previous-task", new Map([[1, createChapter(1)]]))
        ).resolves.toBe(false);
    });

    it("claims compatible cache without requesting destructive confirmation", async () => {
        const storage = await seedBook();

        await expect(
            storage.claimBookCache("700", "new-task", false, undefined, { allowInvalidation: false })
        ).resolves.toMatchObject({ status: "claimed", size: 2, compatibility: "compatible", invalidatedCount: 0 });
    });

    it("does not ask to discard an empty cache with unknown settings", async () => {
        const storage = await import("../../src/storage/cache/book-cache");
        await storage.claimBookCache("700", "previous-task", false);

        await expect(storage.claimBookCache("700", "new-task", false, undefined, {})).resolves.toMatchObject({
            status: "claimed",
            size: 0,
            invalidatedCount: 0
        });
    });

    it("keeps incompatible legacy records intact until invalidation is confirmed", async () => {
        const { get, set } = await import("idb-keyval");
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const sync = await import("../../src/storage/cache/sync");
        const publish = vi.spyOn(sync, "publishCacheSyncEvent");
        const legacy = { ts: Date.now(), chapters: [[3, createChapter(3)]] };
        await set("esj_down_book_700", legacy);

        await expect(storage.claimBookCache("700", "new-task", false)).resolves.toMatchObject({
            status: "needs-confirmation",
            size: 1,
            indexes: [3],
            compatibility: "unknown"
        });
        expect(await repository.readCacheManifestV3("700")).toBeUndefined();
        expect(await get("esj_down_book_700")).toEqual(legacy);
        expect(publish).not.toHaveBeenCalled();

        await expect(
            storage.claimBookCache("700", "new-task", false, undefined, { allowInvalidation: true })
        ).resolves.toMatchObject({ status: "claimed", size: 0, invalidatedCount: 1 });
        expect(await get("esj_down_book_700")).toBeUndefined();
    });
});
