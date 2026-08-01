// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { runWorkerPool } from "../../src/core/download/worker-pool";
import type { Chapter } from "../../src/types";
import { createChapter } from "../support";

describe("3000 chapter cache complexity", () => {
    it("serializes only dirty chapters instead of repeated whole-book snapshots", async () => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        const storage = await import("../../src/core/cache/book-cache");
        const taskId = "stress-task-3000";
        const chapters = new CountingChapterMap();
        await storage.claimBookCache("3000", taskId);

        for (let index = 0; index < 3_000; index++) {
            chapters.set(index, createChapter(index));
            if (chapters.size === 25) {
                expect(await storage.putBookCacheBatchForTask("3000", taskId, chapters)).toBe(true);
                chapters.clear();
            }
        }

        expect(chapters.serializedChapterCount).toBeLessThanOrEqual(3_000);
        expect((await storage.loadBookCache("3000")).size).toBe(3_000);
    });

    it("processes 3000 tasks through a bounded cursor-based worker pool", async () => {
        const processed = new Set<number>();
        let activeCount = 0;
        let maxActiveCount = 0;

        const result = await runWorkerPool({
            items: Array.from({ length: 3_000 }, (_, index) => index),
            concurrency: 5,
            isCancellationRequested: () => false,
            process: async (index) => {
                activeCount += 1;
                maxActiveCount = Math.max(maxActiveCount, activeCount);
                await Promise.resolve();
                processed.add(index);
                activeCount -= 1;
            }
        });

        expect(result).toEqual({ claimedCount: 3_000, completedCount: 3_000, cancelled: false });
        expect(processed.size).toBe(3_000);
        expect(maxActiveCount).toBe(5);
    });
});

class CountingChapterMap extends Map<number, Chapter> {
    serializedChapterCount = 0;

    override [Symbol.iterator](): MapIterator<[number, Chapter]> {
        this.serializedChapterCount += this.size;
        return super[Symbol.iterator]();
    }
}
