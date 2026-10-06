// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createBookLock,
    createCachedData,
    createDeferred,
    createDetailPageFixture,
    installDocumentFixture
} from "../support";
import { setInterfaceLocalePreference } from "../../src/storage/settings";

const mocks = vi.hoisted(() => ({
    runDownload: vi.fn(),
    release: vi.fn(),
    stopHeartbeat: vi.fn(),
    getConflict: vi.fn(),
    acquire: vi.fn(),
    markRunning: vi.fn(),
    startHeartbeat: vi.fn(),
    updateTitle: vi.fn(),
    previewCache: vi.fn(),
    claimCache: vi.fn(),
    selectionPopup: vi.fn(),
    createDownloadPopup: vi.fn(),
    showConflict: vi.fn(),
    showTerminalFailure: vi.fn(),
    fullCleanup: vi.fn(),
    log: vi.fn()
}));

vi.mock("../../src/storage/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: vi.fn()
}));

vi.mock("../../src/download/run", () => ({ runDownload: mocks.runDownload }));

vi.mock("../../src/storage/book-lock", () => ({
    releaseBookDownloadLock: mocks.release,
    shouldDiscardBookDownloadCache: vi.fn(async () => false),
    getConflictingBookDownloadLock: mocks.getConflict,
    acquireBookDownloadLock: mocks.acquire,
    markBookDownloadRunning: mocks.markRunning,
    startBookDownloadLockHeartbeat: mocks.startHeartbeat,
    updateBookDownloadLockTitle: mocks.updateTitle
}));
vi.mock("../../src/storage/cache/book-cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/storage/cache/book-cache")>()),
    previewBookCache: mocks.previewCache,
    claimBookCache: mocks.claimCache
}));
vi.mock("../../src/ui/popups", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/ui/popups")>()),
    showFormatChoice: vi.fn(),
    createDownloadPopup: mocks.createDownloadPopup,
    showBookDownloadInProgressPopup: mocks.showConflict
}));
vi.mock("../../src/ui/dialogs/download-selection", () => ({ createDownloadSelectionPopup: mocks.selectionPopup }));
vi.mock("../../src/ui/dialogs/message", () => ({ showMessagePopup: vi.fn() }));
vi.mock("../../src/utils/dom", () => ({ fullCleanup: mocks.fullCleanup }));
vi.mock("../../src/utils/log", () => ({ log: mocks.log }));
vi.mock("../../src/ui/messages/download-terminal", () => ({
    showCacheDiscardFailure: vi.fn(),
    showDownloadTerminalFailure: mocks.showTerminalFailure
}));

import { runBookDownload } from "../../src/app/book-download";
import { loadDetailBook, loadForumBook } from "../../src/site/book";
const scrapeDetail = () =>
    runBookDownload({
        bookId: "100",
        sourcePageType: "detail",
        pageTitle: document.title,
        loadPlan: async () => loadDetailBook(document, location.href)
    });
const scrapeForum = () =>
    runBookDownload({
        bookId: "100",
        sourcePageType: "forum",
        pageTitle: document.title,
        loadPlan: () => loadForumBook("100", location.origin)
    });
import { state } from "../../src/core/state";

describe("download lifecycle contracts", () => {
    const lock = createBookLock();

    beforeEach(() => {
        setInterfaceLocalePreference("zh-CN");
        vi.clearAllMocks();
        window.history.replaceState({}, "", "/detail/100.html");
        installDocumentFixture(createDetailPageFixture({ bookId: "100", chapterCount: 2 }));
        state.cachedData = null;
        state.runtimeCacheSession = null;
        state.activeDownload = null;

        mocks.getConflict.mockResolvedValue(null);
        mocks.previewCache.mockResolvedValue({ valid: false, size: 0, indexes: [], compatibility: "compatible" });
        mocks.claimCache.mockResolvedValue({
            status: "claimed",
            size: 0,
            map: null,
            compatibility: "compatible",
            invalidatedCount: 0
        });
        mocks.acquire.mockResolvedValue({ acquired: true, lock });
        mocks.markRunning.mockResolvedValue(true);
        mocks.startHeartbeat.mockReturnValue(mocks.stopHeartbeat);
        mocks.updateTitle.mockResolvedValue(undefined);
        mocks.selectionPopup.mockResolvedValue({
            action: "download",
            selection: { mode: "all", sourceTotalChapters: 2, startIndex: 0, endIndex: 1 }
        });
        mocks.runDownload.mockResolvedValue({ status: "ready", data: createCachedData() });
        mocks.release.mockResolvedValue(undefined);
    });

    it.each([
        ["detail", scrapeDetail],
        ["forum", scrapeForum]
    ] as const)("reports an existing task before preparing the %s download", async (_source, scrape) => {
        const previous = createCachedData();
        state.cachedData = previous;
        const fetchPage = vi.fn();
        vi.stubGlobal("fetch", fetchPage);
        if (scrape === scrapeForum) {
            window.history.replaceState({}, "", "/forum/100");
        }
        mocks.getConflict.mockResolvedValueOnce(lock);

        await scrape();

        expect(mocks.getConflict).toHaveBeenCalledWith("100");
        expect(mocks.showConflict).toHaveBeenCalledWith(lock);
        expect(fetchPage).not.toHaveBeenCalled();
        expect(mocks.previewCache).not.toHaveBeenCalled();
        expect(mocks.selectionPopup).not.toHaveBeenCalled();
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.release).not.toHaveBeenCalled();
        expect(state.cachedData).toBe(previous);
    });

    it.each(["success", "failure", "cancel"] as const)("releases exactly once after %s", async (outcome) => {
        if (outcome === "failure") {
            mocks.runDownload.mockRejectedValueOnce(new Error("download failed"));
        } else if (outcome === "cancel") {
            mocks.runDownload.mockImplementationOnce(async () => {
                state.activeDownload?.requestCancellation();
                return { status: "cancelled", outcome: "saved" };
            });
        }

        await scrapeDetail();

        expect(mocks.release).toHaveBeenCalledOnce();
        expect(mocks.release).toHaveBeenCalledWith(lock, { cacheDiscarded: false });
        expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
    });

    it.each([
        ["detail heartbeat", scrapeDetail, mocks.startHeartbeat],
        ["detail popup", scrapeDetail, mocks.createDownloadPopup]
    ] as const)("releases acquired resources when %s initialization fails", async (_name, scrape, initialize) => {
        initialize.mockImplementationOnce(() => {
            throw new Error("initialization failed");
        });

        await scrape();

        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.runDownload).not.toHaveBeenCalled();
        expect(mocks.release).toHaveBeenCalledOnce();
        expect(mocks.release).toHaveBeenCalledWith(lock, { cacheDiscarded: false });
    });

    it("does not remove a terminal notice owned by the download coordinator", async () => {
        mocks.runDownload.mockImplementationOnce(async (_options, dependencies) => {
            dependencies.ui.cleanup();
            mocks.showTerminalFailure({ kind: "download" });
            throw new Error("download failed");
        });
        await scrapeDetail();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
        expect(mocks.fullCleanup.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.showTerminalFailure.mock.invocationCallOrder[0]
        );
    });

    it("shows a common terminal notice when the task lock is lost before downloading", async () => {
        mocks.markRunning.mockResolvedValueOnce(false);

        await scrapeDetail();

        expect(mocks.runDownload).not.toHaveBeenCalled();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
        expect(mocks.showTerminalFailure).toHaveBeenCalledWith({
            kind: "cancellation",
            outcome: "ownership-lost",
            storageFailure: null
        });
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

        expect(mocks.runDownload).not.toHaveBeenCalled();
        expect(mocks.release).toHaveBeenCalledOnce();
        expect(mocks.showTerminalFailure).not.toHaveBeenCalled();
    });
});
