// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";
import { openLegacyCacheFixture } from "../support/legacy-cache";
import { acquireCacheLock } from "../support/book-cache";

describe("cache tombstone cleanup contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
    });

    it("preserves legacy cache when the v3 authority cannot be checked", async () => {
        const { get, set } = openLegacyCacheFixture();
        const storage = await import("../../src/storage/cache/book-cache");
        const key = "esj_down_600";
        const cached = { ts: Date.now(), chapters: [[0, createChapter(0)]] };
        await set(key, cached);

        const read = IDBObjectStore.prototype.get;
        const fault = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(function (
            this: IDBObjectStore,
            key
        ) {
            const request = read.call(this, key);
            request.addEventListener("success", () => this.transaction.abort(), { once: true });
            return request;
        });
        await expect(storage.clearBookCache("600")).rejects.toMatchObject({
            operation: "clear",
            reason: "transaction-aborted"
        });
        fault.mockRestore();
        expect(await get(key)).toEqual(cached);
        expect((await storage.previewBookCache("600", false)).size).toBe(1);

        await expect(storage.clearBookCache("600")).resolves.toBe(true);
        expect(await get(key)).toBeUndefined();
    });

    it("keeps v3 chapters available when the clear transaction fails", async () => {
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
        const chapter = createChapter(0);
        const lock = await acquireCacheLock("602");
        await storage.claimBookCache("602", lock.taskId, false);
        await storage.putBookCacheBatchForTask("602", lock.taskId, new Map([[0, chapter]]));
        await (await import("../../src/storage/book-lock")).releaseBookDownloadLock(lock);

        // 写入清除标记时抛错，先前排队的章节删除也应在同一事务中回滚
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
            throw new Error("manifest write failed");
        });
        await expect(storage.clearBookCache("602")).rejects.toMatchObject({
            reason: "transaction-aborted",
            operation: "clear"
        });
        expect((await repository.readCacheChaptersV3("602")).get(0)).toEqual(chapter);
        await expect(storage.clearBookCache("602")).resolves.toBe(true);
        expect((await storage.previewBookCache("602", false)).size).toBe(0);
    });

    it("retries residual legacy data after a partial batch clear without reimporting it", async () => {
        const { get, set } = openLegacyCacheFixture();
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
        expect((await storage.previewBookCache("601", false)).size).toBe(0);

        fault.mockRestore();
        await expect(storage.clearAllPersistentCaches()).resolves.toEqual([]);
        expect(await get(remainingKey)).toBeUndefined();
        expect(await get(olderKey)).toBeUndefined();
    });

    it("retains a migrated chapter but reports failed legacy deletion on task cleanup", async () => {
        const { get, set } = openLegacyCacheFixture();
        const storage = await import("../../src/storage/cache/book-cache");
        const repository = await import("../../src/storage/cache/indexeddb-repository");
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

        const lock = await acquireCacheLock("604");
        await expect(storage.claimBookCache("604", lock.taskId, false)).resolves.toMatchObject({ status: "claimed" });
        expect((await repository.readCacheChaptersV3("604")).get(0)).toEqual(chapter);
        await expect(storage.clearBookCacheForTask("604", lock.taskId)).rejects.toMatchObject({
            reason: "database-unavailable",
            operation: "clear"
        });
        expect(await get(key)).toBeDefined();
        expect((await storage.previewBookCache("604", false)).size).toBe(0);

        fault.mockRestore();
        await expect(storage.clearBookCacheForTask("604", lock.taskId)).resolves.toBe(true);
        expect(await get(key)).toBeUndefined();
    });
});
