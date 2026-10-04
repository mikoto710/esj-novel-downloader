// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChapter } from "../support";

describe("cache tombstone cleanup contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
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
