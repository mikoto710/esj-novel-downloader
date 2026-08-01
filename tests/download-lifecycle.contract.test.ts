// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookLock, createDetailPageFixture, installDocumentFixture } from "./support";

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
    fullCleanup: vi.fn(),
    log: vi.fn()
}));

vi.mock("../src/core/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: vi.fn()
}));

vi.mock("../src/core/download/batch-download", () => ({ batchDownload: mocks.batchDownload }));
vi.mock("../src/core/download/task-finalizer", () => ({ finalizeBookDownloadTask: mocks.finalize }));
vi.mock("../src/core/book-lock", () => ({
    getConflictingBookDownloadLock: mocks.getConflict,
    acquireBookDownloadLock: mocks.acquire,
    markBookDownloadRunning: mocks.markRunning,
    startBookDownloadLockHeartbeat: mocks.startHeartbeat,
    updateBookDownloadLockTitle: mocks.updateTitle
}));
vi.mock("../src/core/cache/book-cache", () => ({
    loadBookCache: mocks.loadCache,
    claimBookCache: mocks.claimCache
}));
vi.mock("../src/core/parser", () => ({
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
vi.mock("../src/ui/popups", () => ({
    createConfirmPopup: mocks.createConfirmPopup,
    createDownloadPopup: mocks.createDownloadPopup,
    showBookDownloadInProgressPopup: mocks.showConflict
}));
vi.mock("../src/utils/dom", () => ({ fullCleanup: mocks.fullCleanup }));
vi.mock("../src/utils/index", () => ({ log: mocks.log }));

import { scrapeDetail } from "../src/scrapers/detail";
import { state } from "../src/core/state";

describe("download lifecycle contracts", () => {
    const lock = createBookLock();

    beforeEach(() => {
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
        mocks.claimCache.mockResolvedValue({ size: 0, map: null });
        mocks.acquire.mockResolvedValue({ acquired: true, lock });
        mocks.markRunning.mockResolvedValue(true);
        mocks.startHeartbeat.mockReturnValue(mocks.stopHeartbeat);
        mocks.updateTitle.mockResolvedValue(undefined);
        mocks.createConfirmPopup.mockImplementation((onOk: () => void) => onOk());
        mocks.batchDownload.mockResolvedValue(undefined);
        mocks.finalize.mockResolvedValue(undefined);
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
        expect(mocks.finalize).toHaveBeenCalledWith(lock, mocks.stopHeartbeat);
    });
});
