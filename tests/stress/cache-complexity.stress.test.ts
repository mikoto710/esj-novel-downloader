// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { Chapter } from "../../src/types";
import { createChapter } from "../support";

// 当前 v2 整本快照会让断言失败；Phase 4 v3 增量缓存落地后移除 .fails。
describe("3000 chapter cache complexity", () => {
    it.fails("serializes only dirty chapters instead of repeated whole-book snapshots", async () => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        const storage = await import("../../src/core/storage");
        const taskId = "stress-task-3000";
        const chapters = new CountingChapterMap();
        await storage.claimBookCache("3000", taskId);

        for (let index = 0; index < 3_000; index++) {
            chapters.set(index, createChapter(index));
            if ((index + 1) % 5 === 0) {
                expect(await storage.saveBookCacheForTask("3000", taskId, chapters)).toBe(true);
            }
        }

        expect(chapters.serializedChapterCount).toBeLessThanOrEqual(3_000);
    });
});

class CountingChapterMap extends Map<number, Chapter> {
    serializedChapterCount = 0;

    override entries(): MapIterator<[number, Chapter]> {
        this.serializedChapterCount += this.size;
        return super.entries();
    }
}
