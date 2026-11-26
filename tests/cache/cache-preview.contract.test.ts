// @vitest-environment jsdom

import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";
import { createChapterCacheSources } from "../../src/storage/cache/chapter-source";
import { acquireCacheLock } from "../support/book-cache";
import { openLegacyCacheFixture } from "../support/legacy-cache";

describe("cache preview and confirmed claims", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
    });

    async function seedBook(imageEnabled = false) {
        const storage = await import("../../src/storage/cache/book-cache");
        const lock = await acquireCacheLock("700");
        await storage.claimBookCache("700", lock.taskId, imageEnabled);
        await storage.putBookCacheBatchForTask(
            "700",
            lock.taskId,
            new Map([
                [1, createChapter(1)],
                [7, createChapter(7)]
            ]),
            createCacheMeta({ bookId: "700", imageEnabled })
        );
        return { storage, lock };
    }

    it("matches the source at each index and leaves unselected chapters available for a later task", async () => {
        const storage = await import("../../src/storage/cache/book-cache");
        const locks = await import("../../src/storage/book-lock");
        const first = await locks.acquireBookDownloadLock("700", "detail");
        const task = (index: number, chapterId: number) => ({
            index,
            url: `https://www.esjzone.cc/forum/700/${chapterId}.html`,
            title: "Same title"
        });
        const link = { index: 3, url: "https://reader.example/story?id=one", title: "Same title" };
        await storage.claimBookCache("700", first.lock.taskId, false);
        await storage.putBookCacheBatchForTask(
            "700",
            first.lock.taskId,
            new Map([
                [0, createChapter(0, { content: "original first" })],
                [1, createChapter(1, { content: "original second" })],
                [2, createChapter(2, { content: "no source from the older version" })],
                [3, createChapter(3, { content: link.url })]
            ]),
            createCacheMeta({ bookId: "700", imageEnabled: false }),
            undefined,
            createChapterCacheSources([task(0, 45), task(1, 46), link], location.origin)
        );
        await locks.releaseBookDownloadLock(first.lock);

        await expect(
            storage.previewBookCache(
                "700",
                false,
                createChapterCacheSources(
                    [task(0, 44), task(1, 45), task(2, 46), { ...link, url: "https://reader.example/story?id=two" }],
                    location.origin
                )
            )
        ).resolves.toMatchObject({
            size: 4,
            indexes: []
        });

        const second = await locks.acquireBookDownloadLock("700", "forum");
        const claimed = await storage.claimBookCache("700", second.lock.taskId, false, undefined, {
            chapterSources: createChapterCacheSources([task(0, 44), task(2, 46)], location.origin)
        });
        if (claimed.status !== "claimed") throw new Error("expected cache claim");
        expect(claimed.compatibility).toBe("compatible");
        expect(Array.from(claimed.map?.keys() ?? [])).toEqual([1, 3]);
        await locks.releaseBookDownloadLock(second.lock);

        const appended = [task(0, 45), task(1, 46), task(2, 47), link, task(4, 48)];
        appended[0].url = "https://www.esjzone.cc/forum/700/45.html?scroll=1";
        await expect(
            storage.previewBookCache("700", false, createChapterCacheSources(appended, location.origin))
        ).resolves.toMatchObject({
            indexes: [0, 1, 3],
            size: 4
        });
    });

    it("reads only the manifest and chapter keys in one readonly snapshot", async () => {
        const { storage } = await seedBook();
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

    it.each(["expired", "cleared"])("does not restore legacy records behind a %s v3 manifest", async (kind) => {
        const { storage, lock } = await seedBook();
        const { set } = openLegacyCacheFixture();
        const ts = Date.now();
        if (kind === "cleared") {
            await storage.clearBookCacheForTask("700", lock.taskId);
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

    it("uses present v3 manifests without accessing a failing legacy store", async () => {
        const { storage, lock } = await seedBook();
        const clearedLock = await acquireCacheLock("701");
        await storage.claimBookCache("701", clearedLock.taskId, false);
        await storage.clearBookCacheForTask("701", clearedLock.taskId);
        await expect(storage.previewBookCache("700", false)).resolves.toMatchObject({ size: 2 });

        const read = IDBObjectStore.prototype.get;
        const legacyRead = vi.fn(() => {
            throw new DOMException("legacy store unavailable", "InvalidStateError");
        });
        vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
            return this.name === "keyval" ? legacyRead() : read.call(this, key);
        });

        await expect(storage.claimBookCache("700", lock.taskId, false)).resolves.toMatchObject({ size: 2 });
        await expect(storage.claimBookCache("701", clearedLock.taskId, false)).resolves.toMatchObject({ size: 0 });
        expect(legacyRead).not.toHaveBeenCalled();

        const legacyOnly = await acquireCacheLock("702");
        await expect(storage.claimBookCache("702", legacyOnly.taskId, false)).rejects.toMatchObject({
            reason: "database-unavailable"
        });
        expect(legacyRead).toHaveBeenCalledOnce();
    });

    it("keeps v3 entries when the legacy list fails and reports an incomplete list when both fail", async () => {
        const { storage } = await seedBook();
        const { set } = openLegacyCacheFixture();
        const lock = await acquireCacheLock("701");
        await storage.claimBookCache("701", lock.taskId, false);
        await storage.clearBookCacheForTask("701", lock.taskId);
        await set("esj_down_701", { ts: Date.now(), chapters: [[0, createChapter(0)]] });

        await expect(storage.listBookCaches()).resolves.toMatchObject({
            entries: [expect.objectContaining({ bookId: "700" })],
            incomplete: false
        });
        const legacyKeys = vi.spyOn(IDBObjectStore.prototype, "getAllKeys").mockImplementationOnce(() => {
            throw new DOMException("legacy store unavailable", "InvalidStateError");
        });
        await expect(storage.listBookCaches()).resolves.toMatchObject({
            entries: [expect.objectContaining({ bookId: "700" })],
            incomplete: true
        });
        legacyKeys.mockImplementationOnce(() => {
            throw new DOMException("legacy store unavailable", "InvalidStateError");
        });
        vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementationOnce(() => {
            throw new DOMException("manifest list unavailable", "InvalidStateError");
        });
        await expect(storage.listBookCaches()).resolves.toEqual({ entries: [], incomplete: true });
    });

    it("lists only individually verified cache entries when v3 enumeration fails", async () => {
        const { storage } = await seedBook();
        const { set } = openLegacyCacheFixture();
        const cleared = await acquireCacheLock("701");
        await storage.claimBookCache("701", cleared.taskId, false);
        await storage.clearBookCacheForTask("701", cleared.taskId);

        const now = Date.now();
        const clock = vi.spyOn(Date, "now").mockReturnValue(now - 24 * 60 * 60 * 1000 - 1);
        const expired = await acquireCacheLock("703");
        await storage.claimBookCache("703", expired.taskId, false);
        clock.mockRestore();

        const legacy = { ts: now + 1000, chapters: [[0, createChapter(0)]] };
        await Promise.all(["700", "701", "702", "703", "704"].map((bookId) => set(`esj_down_${bookId}`, legacy)));

        vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementationOnce(() => {
            throw new DOMException("manifest list unavailable", "InvalidStateError");
        });
        const read = IDBObjectStore.prototype.get;
        vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
            if (Array.isArray(key) && key[0] === "manifest" && key[1] === "702") {
                throw new DOMException("manifest unavailable for this book", "InvalidStateError");
            }
            return read.call(this, key);
        });
        await expect(storage.listBookCaches()).resolves.toMatchObject({
            entries: [
                { bookId: "704", key: "esj_down_704", chapterCount: 1 },
                { bookId: "700", key: "v3:700", chapterCount: 2 }
            ],
            incomplete: true
        });
    });

    it("requires confirmation without writes or a claimed event by default", async () => {
        const { storage, lock } = await seedBook();
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const sync = await import("../../src/storage/cache/sync");
        const { get, set } = openLegacyCacheFixture();
        await storage.putBookCacheBatchForTask(
            "700",
            lock.taskId,
            new Map([[8, createChapter(8)]]),
            createCacheMeta({ bookId: "700", imageEnabled: true })
        );
        await expect(storage.previewBookCache("700", false)).resolves.toMatchObject({
            valid: true,
            size: 3,
            indexes: [1, 7, 8],
            compatibility: "refetch-required"
        });
        const legacy = { ts: Date.now(), chapters: [[0, createChapter(0)]] };
        await set("esj_down_book_700", legacy);
        await (await import("../../src/storage/book-lock")).releaseBookDownloadLock(lock);
        const nextLock = await acquireCacheLock("700");
        const before = await repository.readCacheManifestV3("700");
        const chaptersBefore = await repository.readCacheChaptersV3("700");
        const publish = vi.spyOn(sync, "publishCacheSyncEvent");
        const put = vi.spyOn(IDBObjectStore.prototype, "put");
        const remove = vi.spyOn(IDBObjectStore.prototype, "delete");
        const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");

        await expect(storage.claimBookCache("700", nextLock.taskId, false)).resolves.toEqual({
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
        expect(await repository.readCacheChaptersV3("700")).toEqual(chaptersBefore);
    });

    it("does not ask to discard an empty cache with unknown settings", async () => {
        const storage = await import("../../src/storage/cache/book-cache");
        const lock = await acquireCacheLock("700");
        await storage.claimBookCache("700", lock.taskId, false);
        await (await import("../../src/storage/book-lock")).releaseBookDownloadLock(lock);
        const nextLock = await acquireCacheLock("700");

        await expect(storage.claimBookCache("700", nextLock.taskId, false, undefined, {})).resolves.toMatchObject({
            status: "claimed",
            size: 0,
            invalidatedCount: 0
        });
    });

    it("keeps incompatible legacy records intact until invalidation is confirmed", async () => {
        const { get, set } = openLegacyCacheFixture();
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const sync = await import("../../src/storage/cache/sync");
        const publish = vi.spyOn(sync, "publishCacheSyncEvent");
        const legacy = { ts: Date.now(), chapters: [[3, createChapter(3)]] };
        await set("esj_down_book_700", legacy);
        for (const imageEnabled of [true, false]) {
            await expect(storage.previewBookCache("700", imageEnabled)).resolves.toMatchObject({
                valid: true,
                size: 1,
                indexes: [3],
                compatibility: "unknown"
            });
        }
        expect(await repository.readCacheManifestV3("700")).toBeUndefined();
        expect(await get("esj_down_book_700")).toEqual(legacy);
        const nextLock = await acquireCacheLock("700");

        await expect(storage.claimBookCache("700", nextLock.taskId, false)).resolves.toMatchObject({
            status: "needs-confirmation",
            size: 1,
            indexes: [3],
            compatibility: "unknown"
        });
        expect(await repository.readCacheManifestV3("700")).toBeUndefined();
        expect(await get("esj_down_book_700")).toEqual(legacy);
        expect(publish).not.toHaveBeenCalled();

        await expect(
            storage.claimBookCache("700", nextLock.taskId, false, undefined, { allowInvalidation: true })
        ).resolves.toMatchObject({ status: "claimed", size: 0, invalidatedCount: 1 });
        expect(await get("esj_down_book_700")).toBeUndefined();
    });
});
