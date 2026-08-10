// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookLock, createDeferred, createDownloadTask } from "../support";

const mocks = vi.hoisted(() => ({
    getConflict: vi.fn(),
    acquire: vi.fn(),
    markRunning: vi.fn(),
    startHeartbeat: vi.fn(),
    updateTitle: vi.fn(),
    stopHeartbeat: vi.fn(),
    loadCache: vi.fn(),
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

vi.mock("../../src/core/book-lock", () => ({
    getConflictingBookDownloadLock: mocks.getConflict,
    acquireBookDownloadLock: mocks.acquire,
    markBookDownloadRunning: mocks.markRunning,
    startBookDownloadLockHeartbeat: mocks.startHeartbeat,
    updateBookDownloadLockTitle: mocks.updateTitle
}));
vi.mock("../../src/core/cache/book-cache", () => ({
    loadBookCache: mocks.loadCache,
    claimBookCache: mocks.claimCache
}));
vi.mock("../../src/core/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: mocks.publishCacheSyncEvent
}));
vi.mock("../../src/core/download/batch-download", () => ({ batchDownload: mocks.batchDownload }));
vi.mock("../../src/core/download/task-finalizer", () => ({ finalizeBookDownloadTask: mocks.finalize }));
vi.mock("../../src/ui/dialogs/range-selection", () => ({ createRangeSelectionPopup: mocks.rangePopup }));
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

import { RangePreflightError, runRangeDownload } from "../../src/scrapers/range";
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
        state.abortFlag = false;
        state.cachedData = null;
        state.globalChaptersMap = new Map();
        state.runtimeCacheSession = null;
        state.activeBookLock = null;
        mocks.getConflict.mockResolvedValue(null);
        mocks.loadCache.mockResolvedValue({ size: 1, map: new Map([[0, { title: "cached" }]]), meta: undefined });
        mocks.claimCache.mockResolvedValue({
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
            state.cachedData = {
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
                    selection: { mode: "range", sourceTotalChapters: 3, startChapter: 2, endChapter: 3 }
                }
            };
        });

        const running = runRangeDownload({
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

        expect(mocks.acquire).toHaveBeenCalledWith("100", "detail");
        expect(mocks.createDownloadPopup).toHaveBeenCalledWith("range");
        expect(mocks.claimCache).toHaveBeenCalledWith("100", lock.taskId, false, expect.any(AbortSignal));
        expect(mocks.batchDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                tasks: [tasks[1], tasks[2]],
                selection: { mode: "range", sourceTotalChapters: 3, startIndex: 1, endIndex: 2 }
            })
        );
        expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(mocks.claimCache.mock.invocationCallOrder[0]);
        expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.publishCacheSyncEvent.mock.invocationCallOrder[0]
        );
    });

    it("treats a lock acquired during selection as the authoritative conflict", async () => {
        mocks.rangePopup.mockResolvedValue({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 3, startIndex: 0, endIndex: 1 }
        });
        mocks.acquire.mockResolvedValueOnce({ acquired: false, lock });

        await runRangeDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "测试小说",
            loadPlan: async () => plan
        });

        expect(mocks.showConflict).toHaveBeenCalledWith(lock);
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.finalize).not.toHaveBeenCalled();
    });

    it("enters finalization immediately after acquiring the lock", async () => {
        mocks.rangePopup.mockResolvedValue({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 3, startIndex: 0, endIndex: 1 }
        });
        mocks.startHeartbeat.mockImplementationOnce(() => {
            throw new Error("heartbeat setup failed");
        });

        await runRangeDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "测试小说",
            loadPlan: async () => plan
        });

        expect(mocks.acquire).toHaveBeenCalledOnce();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.finalize).toHaveBeenCalledWith(lock, expect.any(Function), mocks.log);
    });

    it("keeps lock, writer, heartbeat, and active diagnostics absent after a preflight directory failure", async () => {
        await runRangeDownload({
            bookId: "100",
            sourcePageType: "forum",
            pageTitle: "测试小说",
            loadPlan: async () => {
                throw new RangePreflightError("detail-fetch-failed", "book-metadata");
            }
        });

        expect(mocks.recordPreflightFailure).toHaveBeenCalledOnce();
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.startHeartbeat).not.toHaveBeenCalled();
        expect(mocks.startDiagnostic).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.finalize).not.toHaveBeenCalled();
    });
});
