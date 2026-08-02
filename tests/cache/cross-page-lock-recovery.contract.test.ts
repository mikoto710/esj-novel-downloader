// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";

describe("cross-page lock recovery contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        localStorage.clear();
    });

    it("keeps cache persistence available when BroadcastChannel is missing", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const sync = await import("../../src/core/cache/sync");
        const storage = await import("../../src/core/cache/book-cache");
        const unsubscribe = sync.subscribeCacheSync(vi.fn());

        expect(() => sync.publishCacheSyncEvent({ type: "cache-cleared", bookId: "700" })).not.toThrow();
        await storage.claimBookCache("700", "task-700", false);
        expect(
            await storage.putBookCacheBatchForTask(
                "700",
                "task-700",
                new Map([[0, createChapter(0)]]),
                createCacheMeta({ bookId: "700", imageEnabled: false })
            )
        ).toBe(true);
        expect((await storage.loadBookCache("700")).size).toBe(1);

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
        const sync = await import("../../src/core/cache/sync");

        expect(() => sync.publishCacheSyncEvent({ type: "cache-cleared", bookId: "701" })).not.toThrow();
        expect(() => sync.publishCacheSyncEvent({ type: "cache-cleared", bookId: "702" })).not.toThrow();
        expect(constructorMock).toHaveBeenCalledOnce();
    });

    it("allows different books to download in parallel without sharing lock or cache ownership", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const locks = await import("../../src/core/book-lock");
        const storage = await import("../../src/core/cache/book-cache");
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
        expect((await storage.loadBookCache("710")).size).toBe(0);
        expect((await storage.loadBookCache("711")).map?.get(0)?.content).toBe("second book");

        await Promise.all([locks.releaseBookDownloadLock(first.lock), locks.releaseBookDownloadLock(second.lock)]);
    });

    it("requests cancellation and releases the lock best-effort on pagehide", async () => {
        const { createStore, get } = await import("idb-keyval");
        const locks = await import("../../src/core/book-lock");
        const acquired = await locks.acquireBookDownloadLock("720", "detail");
        if (!acquired.acquired) {
            throw new Error("expected lock");
        }
        const onCancellationRequested = vi.fn();
        const stopHeartbeat = locks.startBookDownloadLockHeartbeat(acquired.lock, onCancellationRequested);

        window.dispatchEvent(new Event("pagehide"));

        await vi.waitFor(async () => {
            const stored = await get("720", createStore("esj-novel-downloader", "book-download-locks"));
            expect(stored).toMatchObject({ taskId: acquired.lock.taskId, status: "released" });
        });
        expect(onCancellationRequested).toHaveBeenCalledOnce();
        expect(onCancellationRequested).toHaveBeenCalledWith("flush");
        expect(await locks.getActiveBookDownloadLock("720")).toBeNull();

        stopHeartbeat();
    });

    it("lets a new task take over an expired lock without granting the stale writer cache access", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const locks = await import("../../src/core/book-lock");
        const storage = await import("../../src/core/cache/book-cache");
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

        vi.spyOn(Date, "now").mockReturnValue(first.lock.heartbeatAt + 60_001);
        const replacement = await locks.acquireBookDownloadLock("730", "forum");
        if (!replacement.acquired) {
            throw new Error("expected expired lock takeover");
        }
        const claimed = await storage.claimBookCache("730", replacement.lock.taskId, false);

        expect(claimed.map?.get(0)?.content).toBe("recoverable chapter");
        expect(await locks.ownsActiveBookDownloadLock(first.lock)).toBe(false);
        expect(await locks.heartbeatBookDownloadLock(first.lock)).toBe(false);
        expect(
            await storage.putBookCacheBatchForTask(
                "730",
                first.lock.taskId,
                new Map([[0, createChapter(0, { content: "stale overwrite" })]])
            )
        ).toBe(false);
        expect(await storage.clearBookCacheForTask("730", first.lock.taskId)).toBe(false);
        expect(
            await storage.putBookCacheBatchForTask(
                "730",
                replacement.lock.taskId,
                new Map([[1, createChapter(1, { content: "replacement chapter" })]])
            )
        ).toBe(true);

        const restored = await storage.loadBookCache("730");
        expect(restored.size).toBe(2);
        expect(restored.map?.get(0)?.content).toBe("recoverable chapter");
        expect(restored.map?.get(1)?.content).toBe("replacement chapter");
        await locks.releaseBookDownloadLock(replacement.lock);
    });
});
