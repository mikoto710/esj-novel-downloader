// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserDownloadMocks, resetBrowserDownloadHarness } from "../support/browser-download-harness";
import { runBookDownload } from "../../src/app/book-download";
import { state } from "../../src/app/page-session";
import { createChapterSelection } from "../../src/download/plan";
import { loadDetailBook, loadForumBook } from "../../src/site/book";
import { setInterfaceLocalePreference } from "../../src/storage/settings";
import {
    createBookLock,
    createCachedData,
    createDeferred,
    createDetailPageFixture,
    installDocumentFixture
} from "../support";

const mocks = getBrowserDownloadMocks();

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

describe("download lifecycle contracts", () => {
    const lock = createBookLock();

    beforeEach(async () => {
        await resetBrowserDownloadHarness();
        setInterfaceLocalePreference("zh-CN");
        window.history.replaceState({}, "", "/detail/100.html");
        installDocumentFixture(createDetailPageFixture({ bookId: "100", chapterCount: 2 }));

        mocks.previewCache.mockResolvedValue({ valid: false, size: 0, indexes: [], compatibility: "compatible" });
        mocks.claimCache.mockResolvedValue({
            status: "claimed",
            size: 0,
            map: null,
            compatibility: "compatible",
            invalidatedCount: 0
        });
        mocks.acquire.mockResolvedValue({ acquired: true, lock });
        mocks.selectionPopup.mockResolvedValue({
            action: "download",
            selection: createChapterSelection([0, 1], 2)
        });
        mocks.runDownload.mockResolvedValue({ status: "ready", data: createCachedData() });
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
            mocks.runDownload.mockResolvedValueOnce({
                status: "failed",
                failure: {
                    kind: "download",
                    code: "Error",
                    params: { detail: "download failed" },
                    storageFailure: null
                }
            });
        } else if (outcome === "cancel") {
            mocks.runDownload.mockImplementationOnce(async () => {
                state.activeDownload?.requestCancellation();
                return { status: "cancelled", outcome: "saved" };
            });
        }

        await scrapeDetail();

        expect(mocks.release).toHaveBeenCalledOnce();
        expect(mocks.release).toHaveBeenCalledWith(lock);
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
        expect(mocks.release).toHaveBeenCalledWith(lock);
    });

    it("presents the core failure once after cleaning its task view", async () => {
        mocks.runDownload.mockResolvedValueOnce({
            status: "failed",
            failure: { kind: "download", code: "Error", params: { detail: "download failed" }, storageFailure: null }
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
