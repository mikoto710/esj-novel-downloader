// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";

describe("cache tombstone cleanup contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
    });

    it("does not enumerate a cleared v3 manifest again", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        const repository = await import("../../src/core/cache/indexeddb-repository");
        await storage.claimBookCache("600", "task-600", false);
        await storage.putBookCacheBatchForTask(
            "600",
            "task-600",
            new Map([[0, createChapter(0)]]),
            createCacheMeta({ bookId: "600", imageEnabled: false, updatedAt: Date.now() })
        );
        await storage.clearAllPersistentCaches();
        const firstTombstone = await repository.readCacheManifestV3("600");
        vi.spyOn(Date, "now").mockReturnValue((firstTombstone?.ts || 0) + 10_000);

        await storage.clearAllPersistentCaches();

        expect(await repository.readCacheManifestV3("600")).toEqual(firstTombstone);
    });

    it("still removes residual v2 data when a v3 tombstone exists", async () => {
        const { get, set } = await import("idb-keyval");
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("601", "task-601", false);
        await storage.clearAllPersistentCaches();
        await set("esj_down_book_601", {
            version: 2,
            ts: Date.now(),
            chapters: [[0, createChapter(0)]]
        });

        await storage.clearAllPersistentCaches();

        expect(await get("esj_down_book_601")).toBeUndefined();
    });
});
