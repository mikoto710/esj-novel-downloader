// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter, createDeferred } from "../support";

describe("book lock contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        localStorage.clear();
    });

    it("acquires, conflicts, heartbeats, and releases a book lock", async () => {
        const locks = await import("../../src/core/book-lock");
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

        await locks.releaseBookDownloadLock(first.lock);
        expect(await locks.getActiveBookDownloadLock("100")).toBeNull();
    });

    it("forwards remote discard intent through the heartbeat", async () => {
        const locks = await import("../../src/core/book-lock");
        const acquired = await locks.acquireBookDownloadLock("104", "detail");
        if (!acquired.acquired) {
            throw new Error("expected lock");
        }
        const cancellationReported = createDeferred<string>();
        const onCancellationRequested = vi.fn((mode: string) => cancellationReported.resolve(mode));
        const stopHeartbeat = locks.startBookDownloadLockHeartbeat(acquired.lock, onCancellationRequested, 1);

        try {
            expect(await locks.requestBookDownloadCancellation("104", true)).toEqual({
                requested: true,
                taskId: acquired.lock.taskId
            });
            await expect(cancellationReported.promise).resolves.toBe("discard");
            expect(onCancellationRequested).toHaveBeenCalledOnce();
        } finally {
            stopHeartbeat();
            await locks.releaseBookDownloadLock(acquired.lock);
        }
    });

    it("does not let a stale task save or clear a replacement task cache", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const locks = await import("../../src/core/book-lock");
        const storage = await import("../../src/core/cache/book-cache");

        const first = await locks.acquireBookDownloadLock("100", "detail");
        if (!first.acquired) {
            throw new Error("expected first lock");
        }
        await storage.claimBookCache("100", first.lock.taskId, false);
        const original = new Map([[0, createChapter(0, { content: "original" })]]);
        expect(
            await storage.putBookCacheBatchForTask(
                "100",
                first.lock.taskId,
                original,
                createCacheMeta({ imageEnabled: false, updatedAt: Date.now() })
            )
        ).toBe(true);
        await locks.releaseBookDownloadLock(first.lock);

        const replacement = await locks.acquireBookDownloadLock("100", "detail");
        if (!replacement.acquired) {
            throw new Error("expected replacement lock");
        }
        await storage.claimBookCache("100", replacement.lock.taskId, false);

        const staleOverwrite = new Map([[0, createChapter(0, { content: "stale overwrite" })]]);
        expect(await storage.putBookCacheBatchForTask("100", first.lock.taskId, staleOverwrite)).toBe(false);
        expect(await storage.clearBookCacheForTask("100", first.lock.taskId)).toBe(false);

        const restored = await storage.loadBookCache("100");
        expect(restored.map?.get(0)?.content).toBe("original");
        expect(await storage.putBookCacheBatchForTask("100", replacement.lock.taskId, restored.map ?? new Map())).toBe(
            true
        );
        await locks.releaseBookDownloadLock(replacement.lock);
    });

    it("lazily migrates v2 chapters after the v3 writer is claimed", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const { get, set } = await import("idb-keyval");
        const storage = await import("../../src/core/cache/book-cache");
        const legacyChapter = createChapter(0, { content: "legacy chapter" });
        await set("esj_down_book_200", {
            version: 2,
            ts: Date.now(),
            chapters: [[0, legacyChapter]],
            meta: createCacheMeta({ bookId: "200", imageEnabled: false, updatedAt: Date.now() })
        });

        expect((await storage.loadBookCache("200")).map?.get(0)?.content).toBe("legacy chapter");
        expect(await get("esj_down_book_200")).toBeDefined();

        const claimed = await storage.claimBookCache("200", "task-200", false);
        expect(claimed.map?.get(0)?.content).toBe("legacy chapter");
        expect(claimed.compatibility).toBe("compatible");
        expect(await get("esj_down_book_200")).toBeUndefined();

        expect(await storage.putBookCacheBatchForTask("200", "task-200", new Map([[1, createChapter(1)]]))).toBe(true);
        expect((await storage.loadBookCache("200")).size).toBe(2);
    });

    it("keeps cleared v3 cache from falling back to residual v2 data", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const { set } = await import("idb-keyval");
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("300", "task-300", false);
        await storage.putBookCacheBatchForTask("300", "task-300", new Map([[0, createChapter(0)]]));
        expect(await storage.clearBookCacheForTask("300", "task-300")).toBe(true);

        await set("esj_down_book_300", {
            version: 2,
            ts: Date.now(),
            chapters: [[0, createChapter(0, { content: "residual legacy chapter" })]]
        });

        expect(await storage.loadBookCache("300")).toEqual({ size: 0, map: null });
        expect(await storage.listBookCaches()).toEqual([]);
    });

    it("rejects an aborted v3 batch without changing persisted chapters", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const locks = await import("../../src/core/book-lock");
        const storage = await import("../../src/core/cache/book-cache");
        const acquired = await locks.acquireBookDownloadLock("103", "detail");
        if (!acquired.acquired) {
            throw new Error("expected lock");
        }
        await storage.claimBookCache("103", acquired.lock.taskId, false);
        expect(
            await storage.putBookCacheBatchForTask(
                "103",
                acquired.lock.taskId,
                new Map([[0, createChapter(0, { content: "persisted" })]])
            )
        ).toBe(true);

        const controller = new AbortController();
        controller.abort();
        expect(
            await storage.putBookCacheBatchForTask(
                "103",
                acquired.lock.taskId,
                new Map([[0, createChapter(0, { content: "aborted" })]]),
                undefined,
                controller.signal
            )
        ).toBe(false);

        const restored = await storage.loadBookCache("103");
        expect(restored.map?.get(0)?.content).toBe("persisted");
        await locks.releaseBookDownloadLock(acquired.lock);
    });
});
