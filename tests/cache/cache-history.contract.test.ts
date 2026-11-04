// @vitest-environment jsdom

import { IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChapter } from "../support";

const historyItem = {
    bookName: "测试小说",
    author: "作者",
    format: "txt",
    sourcePageType: "detail",
    pageUrl: "https://www.esjzone.cc/detail/100.html"
} as const;

describe("cache and history isolation contract", () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
        // 与旧版默认连接共用测试数据库，按用例清空历史
        const history = await import("../../src/storage/history");
        await history.clearDownloadHistory();
    });

    it("reads legacy summaries and retains malformed history records", async () => {
        const { set, get } = await import("idb-keyval");
        const history = await import("../../src/storage/history");
        const { normalizeChapterSelectionSummary } = await import("../../src/download/plan");
        const { isPartialSelectionSummary } = await import("../../src/ui/messages/selection");
        const items = [
            {
                ...historyItem,
                id: "legacy",
                exportedAt: 1,
                selection: { mode: "range", sourceTotalChapters: 9, startChapter: 3, endChapter: 5 }
            },
            {
                ...historyItem,
                id: "malformed",
                exportedAt: 2,
                selection: { mode: "all", sourceTotalChapters: 9, startChapter: 5, endChapter: 3 }
            }
        ];
        await set("esj_down_history", { version: 1, items });

        const loaded = await history.listDownloadHistory();
        expect(loaded.map((item) => item.id)).toEqual(["malformed", "legacy"]);
        expect(normalizeChapterSelectionSummary(loaded[1].selection)).toMatchObject({
            mode: "selected",
            selectedCount: 3,
            ranges: [{ startChapter: 3, endChapter: 5 }]
        });
        expect(normalizeChapterSelectionSummary(loaded[0].selection)).toBeNull();
        expect(isPartialSelectionSummary(loaded[0].selection)).toBe(true);
        expect(await get("esj_down_history")).toEqual({ version: 1, items });
    });

    it("preserves existing history when the read for a removal is aborted", async () => {
        const history = await import("../../src/storage/history");
        await history.addDownloadHistory(historyItem);
        await history.addDownloadHistory({ ...historyItem, bookName: "另一本书" });
        const saved = await history.listDownloadHistory();
        const get = IDBObjectStore.prototype.get;
        vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(function (this: IDBObjectStore, key) {
            const request = get.call(this, key);
            this.transaction.abort();
            return request;
        });

        await expect(history.removeDownloadHistory(saved[0].id)).rejects.toMatchObject({ name: "AbortError" });
        expect(await history.listDownloadHistory()).toEqual(saved);
    });

    it("preserves concurrent additions and does not restore a removed record", async () => {
        const history = await import("../../src/storage/history");
        await history.addDownloadHistory(historyItem);
        const [obsolete] = await history.listDownloadHistory();
        vi.resetModules();
        const otherPage = await import("../../src/storage/history");

        await Promise.all([
            history.addDownloadHistory({ ...historyItem, bookName: "第一册" }),
            otherPage.removeDownloadHistory(obsolete.id),
            history.addDownloadHistory({ ...historyItem, bookName: "第二册" })
        ]);

        expect((await history.listDownloadHistory()).map((item) => item.bookName).sort()).toEqual(["第一册", "第二册"]);
    });

    it("keeps download history when persistent chapter caches are cleared", async () => {
        const locks = await import("../../src/storage/book-lock");
        const storage = await import("../../src/storage/cache/book-cache");
        const history = await import("../../src/storage/history");
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
