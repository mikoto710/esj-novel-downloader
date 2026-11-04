// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";

describe("cache tombstone cleanup contracts", () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
        const { clear } = await import("idb-keyval");
        await clear();
    });

    it("preserves an active legacy writer after a failed read and clears it after release", async () => {
        const { get, set } = await import("idb-keyval");
        const locks = await import("../../src/storage/book-lock");
        const storage = await import("../../src/storage/cache/book-cache");
        const acquired = await locks.acquireBookDownloadLock("600", "detail");
        if (!acquired.acquired) {
            throw new Error("expected lock");
        }
        const key = "esj_down_book_600";
        const cached = { ts: Date.now(), chapters: [[0, createChapter(0)]], writerTaskId: acquired.lock.taskId };
        await set(key, cached);

        const read = IDBObjectStore.prototype.get;
        vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(function (this: IDBObjectStore, key) {
            const request = read.call(this, key);
            this.transaction.abort();
            return request;
        });
        try {
            await expect(storage.clearBookCache("600")).rejects.toMatchObject({
                operation: "clear",
                reason: "transaction-aborted"
            });
            await expect(storage.clearBookCache("600")).resolves.toBe(false);
            expect(await get(key)).toEqual(cached);
        } finally {
            await locks.releaseBookDownloadLock(acquired.lock);
        }
        await expect(storage.clearBookCache("600")).resolves.toBe(true);
        expect(await get(key)).toBeUndefined();
    });

    it("keeps v3 chapters available when the clear transaction fails", async () => {
        const storage = await import("../../src/storage/cache/book-cache");
        const chapter = createChapter(0);
        await storage.claimBookCache("602", "task-602", false);
        await storage.putBookCacheBatchForTask("602", "task-602", new Map([[0, chapter]]));

        // 写入清除标记时抛错，先前排队的章节删除也应在同一事务中回滚
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
            throw new Error("manifest write failed");
        });
        await expect(storage.clearBookCache("602")).rejects.toMatchObject({
            reason: "transaction-aborted",
            operation: "clear"
        });
        expect((await storage.loadBookCache("602")).map?.get(0)).toEqual(chapter);
        await expect(storage.clearBookCache("602")).resolves.toBe(true);
        expect((await storage.loadBookCache("602")).map).toBeNull();
    });

    it("retries residual legacy data after a partial batch clear without reimporting it", async () => {
        const { get, set } = await import("idb-keyval");
        const storage = await import("../../src/storage/cache/book-cache");
        const remainingKey = "esj_down_book_601";
        const olderKey = "esj_down_601";
        const otherKey = "esj_down_603";
        const cached = { version: 2, ts: Date.now(), chapters: [[0, createChapter(0)]] };
        await set(remainingKey, cached);
        await set(olderKey, cached);
        await set(otherKey, cached);
        const remove = IDBObjectStore.prototype.delete;
        const fault = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
            this: IDBObjectStore,
            key
        ) {
            const request = remove.call(this, key);
            if (key === olderKey) {
                request.addEventListener("success", () => {
                    throw new Error("legacy delete failed");
                });
            }
            return request;
        });

        await expect(storage.clearAllPersistentCaches()).rejects.toMatchObject({
            reason: "transaction-aborted",
            operation: "clear"
        });
        expect(await get(otherKey)).toBeUndefined();
        expect(await get(remainingKey)).toEqual(cached);
        expect(await get(olderKey)).toEqual(cached);
        expect((await storage.loadBookCache("601")).map).toBeNull();

        fault.mockRestore();
        await expect(storage.clearAllPersistentCaches()).resolves.toEqual([]);
        expect(await get(remainingKey)).toBeUndefined();
        expect(await get(olderKey)).toBeUndefined();
    });

    it("retains a migrated chapter but reports failed legacy deletion on task cleanup", async () => {
        const { get, set } = await import("idb-keyval");
        const storage = await import("../../src/storage/cache/book-cache");
        const key = "esj_down_604";
        const chapter = createChapter(0);
        await set(key, {
            ts: Date.now(),
            chapters: [[0, chapter]],
            meta: createCacheMeta({ bookId: "604", imageEnabled: false })
        });
        const remove = IDBObjectStore.prototype.delete;
        const fault = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
            this: IDBObjectStore,
            target
        ) {
            if (target === key) {
                throw new DOMException("legacy store unavailable", "InvalidStateError");
            }
            return remove.call(this, target);
        });

        await expect(storage.claimBookCache("604", "task-604", false)).resolves.toMatchObject({ status: "claimed" });
        expect((await storage.loadBookCache("604")).map?.get(0)).toEqual(chapter);
        await expect(storage.clearBookCacheForTask("604", "task-604")).rejects.toMatchObject({
            reason: "database-unavailable",
            operation: "clear"
        });
        expect(await get(key)).toBeDefined();
        expect((await storage.loadBookCache("604")).map).toBeNull();

        fault.mockRestore();
        await expect(storage.clearBookCacheForTask("604", "task-604")).resolves.toBe(true);
        expect(await get(key)).toBeUndefined();
    });
});
