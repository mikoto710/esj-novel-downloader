// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookLock, createCachedData, createDeferred, createDownloadTask } from "../support";

const mocks = vi.hoisted(() => ({
    getConflict: vi.fn(),
    acquire: vi.fn(),
    markRunning: vi.fn(),
    startHeartbeat: vi.fn(),
    updateTitle: vi.fn(),
    stopHeartbeat: vi.fn(),
    previewCache: vi.fn(),
    claimCache: vi.fn(),
    rangePopup: vi.fn(),
    createDownloadPopup: vi.fn(),
    showConflict: vi.fn(),
    showFormatChoice: vi.fn(),
    showMessage: vi.fn(),
    batchDownload: vi.fn(),
    finalize: vi.fn(),
    publishCacheSyncEvent: vi.fn(),
    startDiagnostic: vi.fn(),
    updateDiagnostic: vi.fn(),
    finishDiagnostic: vi.fn(),
    recordFailure: vi.fn(),
    recordPreflightFailure: vi.fn(),
    log: vi.fn(),
    fullCleanup: vi.fn()
}));

vi.mock("../../src/storage/book-lock", () => ({
    getConflictingBookDownloadLock: mocks.getConflict,
    acquireBookDownloadLock: mocks.acquire,
    markBookDownloadRunning: mocks.markRunning,
    startBookDownloadLockHeartbeat: mocks.startHeartbeat,
    updateBookDownloadLockTitle: mocks.updateTitle
}));
vi.mock("../../src/storage/cache/book-cache", () => ({
    previewBookCache: mocks.previewCache,
    claimBookCache: mocks.claimCache
}));
vi.mock("../../src/storage/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: mocks.publishCacheSyncEvent
}));
vi.mock("../../src/adapters/browser-download-dependencies", () => ({ batchDownload: mocks.batchDownload }));
vi.mock("../../src/adapters/book-download-lifecycle", () => ({ finalizeBookDownloadTask: mocks.finalize }));
vi.mock("../../src/ui/dialogs/download-selection", () => ({ createDownloadSelectionPopup: mocks.rangePopup }));
vi.mock("../../src/ui/popups", () => ({
    createDownloadPopup: mocks.createDownloadPopup,
    showBookDownloadInProgressPopup: mocks.showConflict,
    showFormatChoice: mocks.showFormatChoice
}));
vi.mock("../../src/ui/dialogs/message", () => ({ showMessagePopup: mocks.showMessage }));
vi.mock("../../src/ui/messages/download-terminal", () => ({
    showCacheDiscardFailure: vi.fn(),
    showDownloadTerminalFailure: vi.fn()
}));
vi.mock("../../src/utils/dom", () => ({ fullCleanup: mocks.fullCleanup }));
vi.mock("../../src/adapters/browser-diagnostics", () => ({
    browserDiagnosticLog: mocks.log,
    finishBrowserDiagnosticSession: mocks.finishDiagnostic,
    isBrowserDiagnosticSessionActive: vi.fn(() => true),
    recordBrowserDiagnosticFailure: mocks.recordFailure,
    recordBrowserPreflightDiagnosticFailure: mocks.recordPreflightFailure,
    startBrowserDiagnosticSession: mocks.startDiagnostic,
    updateBrowserDiagnosticSession: mocks.updateDiagnostic
}));

import { runBookDownload } from "../../src/scrapers/book-download";
import { BookPreflightError } from "../../src/site/book";
import { state } from "../../src/core/state";

describe("range download lifecycle", () => {
    const lock = createBookLock({ sourcePageType: "detail" });
    const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
    const plan = {
        tasks,
        meta: {
            bookName: "测试小说",
            rawBookName: "测试小说",
            author: "作者",
            introTxt: "简介",
            baseIntroTxt: "简介",
            description: "描述",
            tags: [],
            coverUrl: undefined
        },
        pageUrl: "https://www.esjzone.cc/detail/100.html"
    };

    beforeEach(() => {
        vi.clearAllMocks();
        window.history.replaceState({}, "", "/detail/100.html");
        document.title = "测试小说";
        state.cachedData = null;
        state.runtimeCacheSession = null;
        state.activeDownload = null;
        mocks.getConflict.mockResolvedValue(null);
        mocks.rangePopup.mockResolvedValue({ action: "cancel" });
        mocks.batchDownload.mockResolvedValue({ status: "ready", data: createCachedData() });
        mocks.previewCache.mockResolvedValue({ valid: true, size: 1, indexes: [0], compatibility: "compatible" });
        mocks.claimCache.mockResolvedValue({
            status: "claimed",
            size: 1,
            map: new Map([[0, { title: "cached" }]]),
            compatibility: "compatible",
            invalidatedCount: 0
        });
        mocks.acquire.mockResolvedValue({ acquired: true, lock });
        mocks.markRunning.mockResolvedValue(true);
        mocks.startHeartbeat.mockReturnValue(mocks.stopHeartbeat);
        mocks.updateTitle.mockResolvedValue(undefined);
        mocks.finalize.mockResolvedValue({ cacheDiscarded: false, cacheClearFailure: null });
    });

    it("keeps directory selection outside the lock, then claims the latest cache under the book lock", async () => {
        const selectionDecision = createDeferred<{
            action: "download";
            selection: { mode: "range"; sourceTotalChapters: number; startIndex: number; endIndex: number };
        }>();
        mocks.rangePopup.mockReturnValue(selectionDecision.promise);
        mocks.batchDownload.mockImplementationOnce(async () => {
            const data = {
                txt: "",
                chapters: [],
                metadata: {
                    title: "测试小说",
                    author: "作者",
                    description: "",
                    tags: [],
                    coverBlob: null,
                    coverExt: "jpg"
                },
                epubBlob: null,
                exportContext: {
                    bookId: "100",
                    pageUrl: plan.pageUrl,
                    sourcePageType: "detail",
                    imageEnabled: false,
                    selection: { mode: "range" as const, sourceTotalChapters: 3, startChapter: 2, endChapter: 3 }
                }
            };
            return { status: "ready", data };
        });

        const running = runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "测试小说",
            loadPlan: async () => plan
        });
        await vi.waitFor(() => expect(mocks.rangePopup).toHaveBeenCalledOnce());
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();

        selectionDecision.resolve({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 3, startIndex: 1, endIndex: 2 }
        });
        await running;

        expect(mocks.getConflict).toHaveBeenCalledWith("100");
        expect(mocks.acquire).toHaveBeenCalledWith("100", "detail");
        expect(mocks.createDownloadPopup).toHaveBeenCalledWith("range", expect.any(Function), "测试小说");
        expect(mocks.claimCache).toHaveBeenCalledWith("100", lock.taskId, false, expect.any(AbortSignal), {
            allowInvalidation: false
        });
        expect(mocks.batchDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                tasks: [tasks[1], tasks[2]],
                selection: { mode: "range", sourceTotalChapters: 3, startIndex: 1, endIndex: 2 }
            }),
            expect.objectContaining({ lock, chapters: expect.any(Map), cancellation: expect.any(Object) })
        );
        expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(mocks.claimCache.mock.invocationCallOrder[0]);
        expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.publishCacheSyncEvent.mock.invocationCallOrder[0]
        );
    });

    it("rejects a task acquired after a clear lock precheck", async () => {
        mocks.rangePopup.mockResolvedValue({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 3, startIndex: 0, endIndex: 1 }
        });
        mocks.acquire.mockResolvedValueOnce({ acquired: false, lock });

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "测试小说",
            loadPlan: async () => plan
        });

        expect(mocks.getConflict).toHaveBeenCalledWith("100");
        expect(mocks.showConflict).toHaveBeenCalledWith(lock);
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.finalize).not.toHaveBeenCalled();
    });

    it("keeps lock, writer, heartbeat, and active diagnostics absent after a preflight directory failure", async () => {
        await runBookDownload({
            bookId: "100",
            sourcePageType: "forum",
            pageTitle: "测试小说",
            loadPlan: async () => {
                throw new BookPreflightError("detail-fetch-failed", "book-metadata");
            }
        });

        expect(mocks.recordPreflightFailure).toHaveBeenCalledOnce();
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.startHeartbeat).not.toHaveBeenCalled();
        expect(mocks.startDiagnostic).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.finalize).not.toHaveBeenCalled();
    });
    it("returns to confirmation without starting when the latest cache became incompatible", async () => {
        const selection = { mode: "range", sourceTotalChapters: 3, startIndex: 1, endIndex: 2 };
        mocks.rangePopup
            .mockResolvedValueOnce({ action: "download", selection })
            .mockResolvedValueOnce({ action: "cancel" });
        mocks.claimCache.mockResolvedValueOnce({
            status: "needs-confirmation",
            valid: true,
            size: 3,
            indexes: [0, 1, 2],
            compatibility: "refetch-required"
        });
        const old = createCachedData();
        state.cachedData = old;

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan: async () => plan
        });

        expect(mocks.batchDownload).not.toHaveBeenCalled();
        expect(mocks.finalize).toHaveBeenCalledOnce();
        expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(mocks.rangePopup.mock.invocationCallOrder[1]);
        expect(mocks.rangePopup).toHaveBeenLastCalledWith(
            expect.objectContaining({ cacheWillBeInvalidated: true, cacheCount: 3, initialSelection: selection })
        );
        expect(state.cachedData).toBe(old);
    });

    it("claims again with explicit invalidation consent after showing the changed cache", async () => {
        const selection = { mode: "all", sourceTotalChapters: 3, startIndex: 0, endIndex: 2 };
        mocks.rangePopup.mockResolvedValue({ action: "download", selection });
        mocks.claimCache.mockResolvedValueOnce({
            status: "needs-confirmation",
            valid: true,
            size: 3,
            indexes: [0, 1, 2],
            compatibility: "unknown"
        });

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan: async () => plan
        });

        expect(mocks.claimCache).toHaveBeenNthCalledWith(1, "100", lock.taskId, false, expect.any(AbortSignal), {
            allowInvalidation: false
        });
        expect(mocks.claimCache).toHaveBeenNthCalledWith(2, "100", lock.taskId, false, expect.any(AbortSignal), {
            allowInvalidation: true
        });
        expect(mocks.acquire).toHaveBeenCalledTimes(2);
        expect(mocks.finalize).toHaveBeenCalledTimes(2);
        expect(mocks.batchDownload).toHaveBeenCalledOnce();
    });

    it("keeps the previous export available when the lock precheck cannot be read", async () => {
        const old = createCachedData();
        state.cachedData = old;
        const loadPlan = vi.fn(async () => plan);
        mocks.getConflict.mockRejectedValueOnce(new Error("lock read failed"));
        mocks.rangePopup.mockResolvedValueOnce({ action: "open-existing" });

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan
        });

        expect(loadPlan).not.toHaveBeenCalled();
        expect(mocks.previewCache).not.toHaveBeenCalled();
        expect(mocks.recordPreflightFailure).toHaveBeenCalledWith(
            expect.objectContaining({ failure: expect.objectContaining({ scope: "storage", stage: "lock-read" }) })
        );
        expect(mocks.rangePopup).toHaveBeenCalledWith(
            expect.objectContaining({ hasExistingExport: true, preparationErrorKey: "page.cacheUnavailable.message" })
        );
        expect(mocks.showFormatChoice).toHaveBeenCalledWith(old);
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(state.cachedData).toBe(old);
    });

    it("reopens the previous export even when the cache preview fails", async () => {
        const old = createCachedData();
        state.cachedData = old;
        mocks.previewCache.mockRejectedValueOnce(new Error("database unavailable"));
        mocks.rangePopup.mockResolvedValueOnce({ action: "open-existing" });

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan: async () => plan
        });

        expect(mocks.rangePopup).toHaveBeenCalledWith(
            expect.objectContaining({ hasExistingExport: true, preparationErrorKey: "page.cacheUnavailable.message" })
        );
        expect(mocks.showFormatChoice).toHaveBeenCalledWith(old);
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(state.cachedData).toBe(old);
    });

    it.each(["cancelled", "failed"])("keeps the previous export after a %s attempt", async (status) => {
        const old = createCachedData();
        state.cachedData = old;
        mocks.rangePopup.mockResolvedValueOnce({
            action: "download",
            selection: { mode: "all", sourceTotalChapters: 3, startIndex: 0, endIndex: 2 }
        });
        if (status === "failed") {
            mocks.batchDownload.mockRejectedValueOnce(new Error("download failed"));
        } else {
            mocks.batchDownload.mockResolvedValueOnce({ status: "cancelled", outcome: "saved" });
        }

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan: async () => plan
        });

        expect(state.cachedData).toBe(old);
        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
        expect(mocks.finalize).toHaveBeenCalledOnce();
    });
});
