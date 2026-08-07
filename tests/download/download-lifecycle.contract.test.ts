// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookLock, createDeferred, createDetailPageFixture, installDocumentFixture } from "../support";
import { setInterfaceLocalePreference } from "../../src/core/config";

const mocks = vi.hoisted(() => ({
    batchDownload: vi.fn(),
    finalize: vi.fn(),
    stopHeartbeat: vi.fn(),
    getConflict: vi.fn(),
    acquire: vi.fn(),
    markRunning: vi.fn(),
    startHeartbeat: vi.fn(),
    updateTitle: vi.fn(),
    loadCache: vi.fn(),
    claimCache: vi.fn(),
    createConfirmPopup: vi.fn(),
    createDownloadPopup: vi.fn(),
    showConflict: vi.fn(),
    showTerminalFailure: vi.fn(),
    fullCleanup: vi.fn(),
    log: vi.fn()
}));

vi.mock("../../src/core/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: vi.fn()
}));

vi.mock("../../src/core/download/batch-download", () => ({ batchDownload: mocks.batchDownload }));
vi.mock("../../src/core/download/task-finalizer", () => ({ finalizeBookDownloadTask: mocks.finalize }));
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
vi.mock("../../src/core/parser", () => ({
    parseBookMetadata: vi.fn(() => ({
        bookName: "测试小说",
        rawBookName: "测试小说",
        author: "测试作者",
        introTxt: "简介",
        description: "描述",
        tags: [],
        coverUrl: undefined
    }))
}));
vi.mock("../../src/ui/popups", () => ({
    createConfirmPopup: mocks.createConfirmPopup,
    createDownloadPopup: mocks.createDownloadPopup,
    showBookDownloadInProgressPopup: mocks.showConflict
}));
vi.mock("../../src/utils/dom", () => ({ fullCleanup: mocks.fullCleanup }));
vi.mock("../../src/utils/index", () => ({ log: mocks.log }));
vi.mock("../../src/ui/download-terminal-notices", () => ({
    showCacheDiscardFailure: vi.fn(),
    showDownloadTerminalFailure: mocks.showTerminalFailure
}));

import { scrapeDetail } from "../../src/scrapers/detail";
import { state } from "../../src/core/state";

describe("download lifecycle contracts", () => {
    const lock = createBookLock();

    beforeEach(() => {
        setInterfaceLocalePreference("zh-CN");
        vi.clearAllMocks();
        window.history.replaceState({}, "", "/detail/100.html");
        installDocumentFixture(createDetailPageFixture({ bookId: "100", chapterCount: 2 }));
        state.abortFlag = false;
        state.cachedData = null;
        state.globalChaptersMap = new Map();
        state.runtimeCacheSession = null;
        state.activeBookLock = null;

        mocks.getConflict.mockResolvedValue(null);
        mocks.loadCache.mockResolvedValue({ size: 0, map: null });
        mocks.claimCache.mockResolvedValue({
            size: 0,
            map: null,
            compatibility: "compatible",
            invalidatedCount: 0
        });
        mocks.acquire.mockResolvedValue({ acquired: true, lock });
        mocks.markRunning.mockResolvedValue(true);
        mocks.startHeartbeat.mockReturnValue(mocks.stopHeartbeat);
        mocks.updateTitle.mockResolvedValue(undefined);
        mocks.createConfirmPopup.mockImplementation((onOk: () => void) => onOk());
        mocks.batchDownload.mockResolvedValue(undefined);
        mocks.finalize.mockResolvedValue({ cacheDiscarded: false, cacheClearFailure: null });
    });

    it.each(["success", "failure", "cancel"] as const)("finalizes exactly once after %s", async (outcome) => {
        if (outcome === "failure") {
            mocks.batchDownload.mockRejectedValueOnce(new Error("download failed"));
        } else if (outcome === "cancel") {
            mocks.batchDownload.mockImplementationOnce(async () => {
                state.abortFlag = true;
            });
        }

        await scrapeDetail();

        expect(mocks.finalize).toHaveBeenCalledOnce();
        expect(mocks.finalize).toHaveBeenCalledWith(lock, mocks.stopHeartbeat, expect.any(Function));
    });

    it("does not remove a terminal notice owned by the download coordinator", async () => {
        mocks.batchDownload.mockRejectedValueOnce(new Error("download failed"));

        await scrapeDetail();

        expect(mocks.fullCleanup).not.toHaveBeenCalled();
    });

    it("shows a common terminal notice when the task lock is lost before downloading", async () => {
        mocks.markRunning.mockResolvedValueOnce(false);

        await scrapeDetail();

        expect(mocks.batchDownload).not.toHaveBeenCalled();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
        expect(mocks.showTerminalFailure).toHaveBeenCalledWith({
            kind: "cancellation",
            outcome: "ownership-lost",
            storageFailure: null
        });
    });

    it("shows cache preparation before claiming the writer", async () => {
        await scrapeDetail();

        expect(mocks.log).toHaveBeenCalledWith("正在准备本地缓存...");
        expect(mocks.claimCache).toHaveBeenCalledWith("100", lock.taskId, false, expect.any(AbortSignal));
        expect(mocks.log.mock.invocationCallOrder[0]).toBeLessThan(mocks.claimCache.mock.invocationCallOrder[0]);
    });

    it("cancels an in-progress cache claim before starting the download", async () => {
        const claimStarted = createDeferred<void>();
        const claimAborted = createDeferred<void>();
        let requestCancellation: ((mode: "flush" | "discard") => void) | undefined;
        mocks.startHeartbeat.mockImplementationOnce((_lock, onCancellationRequested) => {
            requestCancellation = onCancellationRequested;
            return mocks.stopHeartbeat;
        });
        mocks.claimCache.mockImplementationOnce((_bookId, _taskId, _imageEnabled, signal?: AbortSignal) => {
            claimStarted.resolve();
            return new Promise((_resolve, reject) => {
                signal?.addEventListener(
                    "abort",
                    () => {
                        claimAborted.resolve();
                        reject(new DOMException("缓存事务已中止", "AbortError"));
                    },
                    { once: true }
                );
            });
        });

        const scrapePromise = scrapeDetail();
        await claimStarted.promise;
        requestCancellation?.("discard");
        await claimAborted.promise;
        await scrapePromise;

        expect(mocks.batchDownload).not.toHaveBeenCalled();
        expect(mocks.finalize).toHaveBeenCalledOnce();
        expect(mocks.log.mock.calls.flat().join("\n")).not.toContain("抓取流程异常");
    });

    it("passes the confirmed image setting snapshot through cache claim and download", async () => {
        GM_setValue("enable_image_download", true);

        await scrapeDetail();

        expect(mocks.claimCache).toHaveBeenCalledWith("100", lock.taskId, true, expect.any(AbortSignal));
        expect(mocks.batchDownload).toHaveBeenCalledWith(expect.objectContaining({ imageEnabled: true }));
    });
});
