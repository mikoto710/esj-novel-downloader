// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChapter } from "../support";

describe("cache and history isolation contract", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
    });

    it("keeps download history when persistent chapter caches are cleared", async () => {
        const locks = await import("../../src/core/book-lock");
        const storage = await import("../../src/core/cache/book-cache");
        const history = await import("../../src/core/download-history");
        const acquired = await locks.acquireBookDownloadLock("100", "detail");
        if (!acquired.acquired) {
            throw new Error("expected lock");
        }

        await storage.claimBookCache("100", acquired.lock.taskId, false);
        await storage.putBookCacheBatchForTask("100", acquired.lock.taskId, new Map([[0, createChapter(0)]]));
        await history.addDownloadHistory({
            bookId: "100",
            bookName: "测试小说",
            author: "测试作者",
            format: "txt",
            sourcePageType: "detail",
            chapterSummary: { totalCount: 1, missingCount: 0 },
            pageUrl: "https://www.esjzone.cc/detail/100.html"
        });
        await locks.releaseBookDownloadLock(acquired.lock);

        await storage.clearAllPersistentCaches();

        expect((await storage.loadBookCache("100")).size).toBe(0);
        expect(await history.listDownloadHistory()).toEqual([
            expect.objectContaining({ bookId: "100", bookName: "测试小说", format: "txt" })
        ]);
    });
});
