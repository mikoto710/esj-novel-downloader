// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter, createDeferred } from "../support";
import { openLegacyCacheFixture } from "../support/legacy-cache";
import { acquireCacheLock } from "../support/book-cache";

describe("book lock contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        localStorage.clear();
    });

    it("acquires, conflicts, heartbeats, and releases a book lock", async () => {
        const locks = await import("../../src/storage/book-lock");
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("storage full", "QuotaExceededError");
        });
        const first = await locks.acquireBookDownloadLock("100", "detail");
        expect(first.acquired).toBe(true);
        if (!first.acquired) {
            throw new Error("expected the first lock to be acquired");
        }

        const conflict = await locks.acquireBookDownloadLock("100", "forum");
        expect(conflict).toEqual({ acquired: false, lock: expect.objectContaining({ taskId: first.lock.taskId }) });

        expect(await locks.markBookDownloadRunning(first.lock)).toBe(true);
        const heartbeatAt = first.lock.heartbeatAt + 3_000;
        vi.spyOn(Date, "now").mockReturnValue(heartbeatAt);
        expect(await locks.heartbeatBookDownloadLock(first.lock)).toBe(true);
        expect((await locks.getActiveBookDownloadLock("100"))?.heartbeatAt).toBe(heartbeatAt);

        await expect(locks.releaseBookDownloadLock(first.lock)).resolves.toBe("released");
        expect(await locks.getActiveBookDownloadLock("100")).toBeNull();
        await expect(locks.requestBookDownloadCancellation("100", first.lock.taskId, true)).resolves.toEqual({
            requested: false,
            status: "not-active"
        });
    });

    it("forwards remote discard intent through the heartbeat", async () => {
        const locks = await import("../../src/storage/book-lock");
        const acquired = await locks.acquireBookDownloadLock("104", "detail");
        if (!acquired.acquired) {
            throw new Error("expected lock");
        }
        const cancellationReported = createDeferred<string>();
        const onCancellationRequested = vi.fn((mode: string) => cancellationReported.resolve(mode));
        const stopHeartbeat = locks.startBookDownloadLockHeartbeat(acquired.lock, onCancellationRequested, 1);

        try {
            expect((await indexedDB.databases()).map(({ name }) => name)).toEqual(["esj-novel-downloader"]);
            expect(await locks.requestBookDownloadCancellation("104", acquired.lock.taskId, true)).toEqual({
                requested: true,
                taskId: acquired.lock.taskId
            });
            await expect(cancellationReported.promise).resolves.toBe("discard");
            expect(onCancellationRequested).toHaveBeenCalledOnce();
        } finally {
            stopHeartbeat();
            await locks.releaseBookDownloadLock(acquired.lock, { cacheDiscarded: false });
        }
    });

    it("rejects cancellation confirmed for the previous task", async () => {
        const locks = await import("../../src/storage/book-lock");
        const previous = await acquireCacheLock("104");
        await locks.releaseBookDownloadLock(previous);
        const current = await acquireCacheLock("104");

        await expect(locks.requestBookDownloadCancellation("104", previous.taskId, true)).resolves.toEqual({
            requested: false,
            status: "replaced"
        });
        expect(await locks.markBookDownloadRunning(current)).toBe(true);
        expect(await locks.shouldDiscardBookDownloadCache(current)).toBe(false);
        await expect(locks.releaseBookDownloadLock(previous)).resolves.toBe("ownership-lost");
        await locks.releaseBookDownloadLock(current);
    });

    it.each([true, false])(
        "keeps a late discard request until cleanup is attempted (cleared: %s)",
        async (cacheDiscarded) => {
            vi.stubGlobal("BroadcastChannel", undefined);
            const locks = await import("../../src/storage/book-lock");
            const storage = await import("../../src/storage/cache/book-cache");
            const current = await acquireCacheLock("104");
            if (cacheDiscarded) {
                await storage.claimBookCache("104", current.taskId, false);
            }

            await expect(locks.requestBookDownloadCancellation("104", current.taskId, true)).resolves.toEqual({
                requested: true,
                taskId: current.taskId
            });
            await expect(locks.releaseBookDownloadLock(current)).resolves.toBe("discard-requested");
            expect(await locks.ownsActiveBookDownloadLock(current)).toBe(true);
            const cleared = await storage.clearBookCacheForTask("104", current.taskId);
            expect(cleared).toBe(cacheDiscarded);
            await expect(locks.releaseBookDownloadLock(current, { cacheDiscarded: cleared })).resolves.toBe("released");
            await expect(locks.waitForBookDownloadCancellation("104", current.taskId)).resolves.toEqual({
                status: "released",
                cacheCleared: cacheDiscarded
            });
        }
    );

    it("closes a range writer idempotently and rejects delayed writes until the next claim", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const meta = createCacheMeta({ bookId: "105", totalChapters: 20, updatedAt: Date.now() });

        const lock = await acquireCacheLock("105");
        await storage.claimBookCache("105", lock.taskId, false);
        expect(
            await storage.putBookCacheBatchForTask("105", lock.taskId, new Map([[10, createChapter(10)]]), meta)
        ).toBe(true);
        expect(await storage.finishBookCacheForTask("105", lock.taskId, meta)).toBe(true);
        const firstClosedAt = (await repository.readCacheManifestV3("105"))?.writerClosedAt;
        expect(firstClosedAt).toBeTypeOf("number");

        vi.spyOn(Date, "now").mockReturnValue((firstClosedAt ?? 0) + 10_000);
        expect(await storage.finishBookCacheForTask("105", lock.taskId, meta)).toBe(true);
        expect((await repository.readCacheManifestV3("105"))?.writerClosedAt).toBe(firstClosedAt);
        expect(
            await storage.putBookCacheBatchForTask("105", lock.taskId, new Map([[11, createChapter(11)]]), meta)
        ).toBe(false);

        await (await import("../../src/storage/book-lock")).releaseBookDownloadLock(lock);
        const nextLock = await acquireCacheLock("105");
        await storage.claimBookCache("105", nextLock.taskId, false);
        expect((await repository.readCacheManifestV3("105"))?.writerClosedAt).toBeUndefined();
        expect(
            await storage.putBookCacheBatchForTask("105", nextLock.taskId, new Map([[11, createChapter(11)]]), meta)
        ).toBe(true);
        expect(await storage.clearBookCacheForTask("105", lock.taskId)).toBe(false);
    });

    it("allows stop-and-clear to remove a writer that was already closed by the same task", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const storage = await import("../../src/storage/cache/book-cache");
        const meta = createCacheMeta({ bookId: "106", totalChapters: 5, updatedAt: Date.now() });

        const lock = await acquireCacheLock("106");
        await storage.claimBookCache("106", lock.taskId, false);
        await storage.putBookCacheBatchForTask("106", lock.taskId, new Map([[2, createChapter(2)]]), meta);
        expect(await storage.finishBookCacheForTask("106", lock.taskId, meta)).toBe(true);
        expect(await storage.clearBookCacheForTask("106", lock.taskId)).toBe(true);
        expect(await storage.previewBookCache("106", false)).toMatchObject({ size: 0, indexes: [] });
    });

    it("lazily migrates v2 chapters after the v3 writer is claimed", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const { get, set } = openLegacyCacheFixture();
        const storage = await import("../../src/storage/cache/book-cache");
        const legacyChapter = createChapter(0, { content: "legacy chapter" });
        await set("esj_down_book_200", {
            version: 2,
            ts: Date.now(),
            chapters: [[0, legacyChapter]],
            meta: createCacheMeta({ bookId: "200", imageEnabled: false, updatedAt: Date.now() })
        });

        expect((await storage.previewBookCache("200", false)).indexes).toEqual([0]);
        expect(await get("esj_down_book_200")).toBeDefined();

        const lock = await acquireCacheLock("200");
        const claimed = await storage.claimBookCache("200", lock.taskId, false);
        if (claimed.status !== "claimed") throw new Error("expected compatible cache claim");
        expect(claimed.map?.get(0)?.content).toBe("legacy chapter");
        expect(claimed.compatibility).toBe("compatible");
        expect(await get("esj_down_book_200")).toBeUndefined();

        expect(await storage.putBookCacheBatchForTask("200", lock.taskId, new Map([[1, createChapter(1)]]))).toBe(true);
        expect((await storage.previewBookCache("200", false)).size).toBe(2);
    });

    it("waits for the transaction abort event before returning signal cancellation", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const original = createChapter(0, { content: "persisted" });
        const lock = await acquireCacheLock("108");
        await storage.claimBookCache("108", lock.taskId, false);
        await storage.putBookCacheBatchForTask("108", lock.taskId, new Map([[0, original]]));
        const replacement = new Map([[0, createChapter(0, { content: "replacement" })]]);
        const preCancelled = new AbortController();
        preCancelled.abort();
        await expect(
            storage.putBookCacheBatchForTask("108", lock.taskId, replacement, undefined, preCancelled.signal)
        ).resolves.toBe(false);
        expect(await repository.readCacheChaptersV3("108")).toEqual(new Map([[0, original]]));

        const controller = new AbortController();
        let aborted = false;
        const put = IDBObjectStore.prototype.put;
        const injected = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
            this: IDBObjectStore,
            value,
            key
        ) {
            const request = put.call(this, value, key);
            if (Array.isArray(key) && key[0] === "chapter" && key[1] === "108") {
                this.transaction.addEventListener(
                    "abort",
                    () => {
                        aborted = true;
                    },
                    { once: true }
                );
                request.addEventListener("success", () => controller.abort(), { once: true });
            }
            return request;
        });
        try {
            await expect(
                storage.putBookCacheBatchForTask("108", lock.taskId, replacement, undefined, controller.signal)
            ).resolves.toBe(false);
            expect(aborted).toBe(true);
        } finally {
            injected.mockRestore();
        }
        expect(await repository.readCacheChaptersV3("108")).toEqual(new Map([[0, original]]));
    });

    it("rolls back chapters, sources, and manifest when a transaction aborts after their requests succeed", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const original = createChapter(0, { content: "persisted" });
        const meta = createCacheMeta({ bookId: "107", totalChapters: 1, updatedAt: Date.now() });
        const lock = await acquireCacheLock("107");
        await storage.claimBookCache("107", lock.taskId, false);
        const sources = new Map([[0, "esj:107/1"]]);
        await storage.putBookCacheBatchForTask("107", lock.taskId, new Map([[0, original]]), meta, undefined, sources);
        const manifest = await repository.readCacheManifestV3("107");
        const put = IDBObjectStore.prototype.put;
        const writtenChapters: number[] = [];
        let manifestWritten = false;
        const injected = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
            this: IDBObjectStore,
            value,
            key
        ) {
            const request = put.call(this, value, key);
            if (this.name === "records" && Array.isArray(key) && key[1] === "107") {
                const index = key[2];
                if (key[0] === "chapter" && typeof index === "number") {
                    request.addEventListener("success", () => writtenChapters.push(index));
                }
                if (key[0] === "manifest")
                    request.addEventListener("success", () => {
                        manifestWritten = true;
                        this.transaction.abort();
                    });
            }
            return request;
        });

        try {
            await expect(
                storage.putBookCacheBatchForTask(
                    "107",
                    lock.taskId,
                    new Map([
                        [0, createChapter(0, { content: "replacement" })],
                        [1, createChapter(1)]
                    ]),
                    { ...meta, totalChapters: 2, updatedAt: meta.updatedAt + 1 },
                    undefined,
                    new Map([
                        [0, "esj:107/2"],
                        [1, "esj:107/3"]
                    ])
                )
            ).rejects.toMatchObject({ operation: "write" });
        } finally {
            injected.mockRestore();
        }

        expect(writtenChapters).toEqual(expect.arrayContaining([0, 1]));
        expect(manifestWritten).toBe(true);
        expect(await repository.readCacheManifestV3("107")).toEqual(manifest);
        expect(await repository.readCacheChaptersV3("107")).toEqual(new Map([[0, original]]));
        expect((await storage.previewBookCache("107", false, sources)).indexes).toEqual([0]);
    });
});
