// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChapter } from "./support";

describe("book lock contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        localStorage.clear();
    });

    it("acquires, conflicts, heartbeats, and releases a book lock", async () => {
        const locks = await import("../src/core/book-lock");
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

    it("does not let a stale task save or clear a replacement task cache", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const locks = await import("../src/core/book-lock");
        const storage = await import("../src/core/storage");

        const first = await locks.acquireBookDownloadLock("100", "detail");
        if (!first.acquired) {
            throw new Error("expected first lock");
        }
        await storage.claimBookCache("100", first.lock.taskId);
        const original = new Map([[0, createChapter(0, { content: "original" })]]);
        expect(await storage.saveBookCacheForTask("100", first.lock.taskId, original)).toBe(true);
        await locks.releaseBookDownloadLock(first.lock);

        const replacement = await locks.acquireBookDownloadLock("100", "detail");
        if (!replacement.acquired) {
            throw new Error("expected replacement lock");
        }
        await storage.claimBookCache("100", replacement.lock.taskId);

        const staleOverwrite = new Map([[0, createChapter(0, { content: "stale overwrite" })]]);
        expect(await storage.saveBookCacheForTask("100", first.lock.taskId, staleOverwrite)).toBe(false);
        expect(await storage.clearBookCacheForTask("100", first.lock.taskId)).toBe(false);

        const restored = await storage.loadBookCache("100");
        expect(restored.map?.get(0)?.content).toBe("original");
        expect(await storage.saveBookCacheForTask("100", replacement.lock.taskId, restored.map ?? new Map())).toBe(
            true
        );
        await locks.releaseBookDownloadLock(replacement.lock);
    });
});
