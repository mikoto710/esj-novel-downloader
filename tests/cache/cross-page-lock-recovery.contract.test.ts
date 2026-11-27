// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter, createDeferred } from "../support";
import { acquireCacheLock } from "../support/book-cache";

describe("cross-page lock recovery contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        localStorage.clear();
    });

    it("keeps cache persistence available when BroadcastChannel is missing", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const sync = await import("../../src/storage/cache/sync");
        const storage = await import("../../src/storage/cache/book-cache");
        const unsubscribe = sync.subscribeCacheSync(vi.fn());

        expect(() => sync.publishCacheSyncEvent({ type: "cache-cleared", bookId: "700" })).not.toThrow();
        const lock = await acquireCacheLock("700");
        await storage.claimBookCache("700", lock.taskId, false);
        expect(
            await storage.putBookCacheBatchForTask(
                "700",
                lock.taskId,
                new Map([[0, createChapter(0)]]),
                createCacheMeta({ bookId: "700", imageEnabled: false })
            )
        ).toBe(true);
        expect((await storage.previewBookCache("700", false)).size).toBe(1);

        unsubscribe();
    });

    it("disables cache sync after BroadcastChannel construction fails", async () => {
        const constructorMock = vi.fn();

        class ThrowingBroadcastChannel {
            constructor() {
                constructorMock();
                throw new DOMException("channel unavailable", "NotSupportedError");
            }
        }

        vi.stubGlobal("BroadcastChannel", ThrowingBroadcastChannel);
        const sync = await import("../../src/storage/cache/sync");

        expect(() => sync.publishCacheSyncEvent({ type: "cache-cleared", bookId: "701" })).not.toThrow();
        expect(() => sync.publishCacheSyncEvent({ type: "cache-cleared", bookId: "702" })).not.toThrow();
        expect(constructorMock).toHaveBeenCalledOnce();
    });

    it("allows different books to download in parallel without sharing lock or cache ownership", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const locks = await import("../../src/storage/book-lock");
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const [first, second] = await Promise.all([
            locks.acquireBookDownloadLock("710", "detail"),
            locks.acquireBookDownloadLock("711", "forum")
        ]);
        if (!first.acquired || !second.acquired) {
            throw new Error("expected both books to acquire independent locks");
        }

        await Promise.all([
            storage.claimBookCache("710", first.lock.taskId, false),
            storage.claimBookCache("711", second.lock.taskId, false)
        ]);
        expect(
            await Promise.all([
                storage.putBookCacheBatchForTask(
                    "710",
                    first.lock.taskId,
                    new Map([[0, createChapter(0, { content: "first book" })]])
                ),
                storage.putBookCacheBatchForTask(
                    "711",
                    second.lock.taskId,
                    new Map([[0, createChapter(0, { content: "second book" })]])
                )
            ])
        ).toEqual([true, true]);

        expect(
            await storage.putBookCacheBatchForTask(
                "711",
                first.lock.taskId,
                new Map([[0, createChapter(0, { content: "cross-book overwrite" })]])
            )
        ).toBe(false);
        expect(await storage.clearBookCacheForTask("710", first.lock.taskId)).toBe(true);
        expect((await storage.previewBookCache("710", false)).size).toBe(0);
        expect((await repository.readCacheChaptersV3("711")).get(0)?.content).toBe("second book");

        await Promise.all([locks.releaseBookDownloadLock(first.lock), locks.releaseBookDownloadLock(second.lock)]);
    });

    it("rejects stale writes and queued claims after the replacement claims the cache", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const locks = await import("../../src/storage/book-lock");
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const first = await locks.acquireBookDownloadLock("730", "detail");
        if (!first.acquired) {
            throw new Error("expected first lock");
        }
        await storage.claimBookCache("730", first.lock.taskId, false);
        await storage.putBookCacheBatchForTask(
            "730",
            first.lock.taskId,
            new Map([[0, createChapter(0, { content: "recoverable chapter" })]]),
            createCacheMeta({ bookId: "730", imageEnabled: false })
        );

        const lateClaimQueued = createDeferred<void>();
        const resumeLateClaim = createDeferred<void>();
        const claimCacheV3 = repository.claimCacheV3;
        vi.spyOn(repository, "claimCacheV3").mockImplementationOnce(async (...args) => {
            lateClaimQueued.resolve();
            await resumeLateClaim.promise;
            return claimCacheV3(...args);
        });
        const lateClaim = storage
            .claimBookCache("730", first.lock.taskId, true, undefined, { allowInvalidation: true })
            .catch((error: unknown) => error);
        let replacement: Awaited<ReturnType<typeof locks.acquireBookDownloadLock>>;
        try {
            await vi.waitFor(() => expect(lateClaimQueued.settled).toBe(true));
            vi.spyOn(Date, "now").mockReturnValue(first.lock.heartbeatAt + 60_001);
            replacement = await locks.acquireBookDownloadLock("730", "forum");
            expect(replacement.acquired).toBe(true);
            expect(await storage.clearBookCache("730")).toBe(false);
            await expect(storage.claimBookCache("730", replacement.lock.taskId, false)).resolves.toMatchObject({
                status: "claimed",
                size: 1
            });
        } finally {
            resumeLateClaim.resolve();
        }
        expect(await lateClaim).toMatchObject({ reason: "ownership-lost" });
        const staleBatch = new Map([[0, createChapter(0, { content: "stale overwrite" })]]);
        expect(await locks.ownsActiveBookDownloadLock(first.lock)).toBe(false);
        expect(await locks.heartbeatBookDownloadLock(first.lock)).toBe(false);
        expect(await storage.putBookCacheBatchForTask("730", first.lock.taskId, staleBatch)).toBe(false);
        expect(await storage.clearBookCacheForTask("730", first.lock.taskId)).toBe(false);
        expect(
            await storage.putBookCacheBatchForTask(
                "730",
                replacement.lock.taskId,
                new Map([[1, createChapter(1, { content: "replacement chapter" })]])
            )
        ).toBe(true);

        const restored = await repository.readCacheChaptersV3("730");
        expect(restored.size).toBe(2);
        expect(restored.get(0)?.content).toBe("recoverable chapter");
        expect(restored.get(1)?.content).toBe("replacement chapter");
        await locks.releaseBookDownloadLock(replacement.lock);
        await expect(storage.claimBookCache("730", first.lock.taskId, false)).rejects.toMatchObject({
            reason: "ownership-lost"
        });
    });
});
