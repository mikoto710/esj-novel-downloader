// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserDownloadMocks, resetBrowserDownloadHarness } from "../support/browser-download-harness";
import { runBookDownload } from "../../src/app/book-download";
import { state } from "../../src/app/page-session";
import { recordBrowserPreflightDiagnosticFailure, startBrowserDiagnosticSession } from "../../src/diagnostics/runtime";
import { createRangeSelection } from "../../src/download/plan";
import { BookPreflightError } from "../../src/site/book";
import { publishCacheSyncEvent } from "../../src/storage/cache/sync";
import { createBookLock, createCachedData, createDeferred, createDownloadTask } from "../support";

vi.mock("../../src/diagnostics/runtime");

const mocks = getBrowserDownloadMocks();

describe("range download lifecycle", () => {
    const lock = createBookLock({ sourcePageType: "detail" });
    const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
    const plan = {
        tasks,
        directory: { html: "", chapterCount: tasks.length },
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

    beforeEach(async () => {
        await resetBrowserDownloadHarness();
        window.history.replaceState({}, "", "/detail/100.html");
        document.title = "测试小说";
        mocks.selectionPopup.mockResolvedValue({ action: "cancel" });
        mocks.runDownload.mockResolvedValue({ status: "ready", data: createCachedData() });
        mocks.previewCache.mockResolvedValue({ valid: true, size: 1, indexes: [0], compatibility: "compatible" });
        mocks.claimCache.mockResolvedValue({
            status: "claimed",
            size: 1,
            map: new Map([[0, { title: "cached" }]]),
            compatibility: "compatible",
            invalidatedCount: 0
        });
        mocks.acquire.mockResolvedValue({ acquired: true, lock });
    });

    it("keeps directory selection outside the lock, then claims the latest cache under the book lock", async () => {
        const settings = await import("../../src/storage/settings");
        const readImages = vi.spyOn(settings, "getImageDownloadSetting").mockReturnValue(false);
        const readConcurrency = vi.spyOn(settings, "getConcurrency").mockReturnValue(2);
        const selectionDecision = createDeferred<{
            action: "download";
            selection: ReturnType<typeof createRangeSelection>;
        }>();
        mocks.selectionPopup.mockReturnValue(selectionDecision.promise);
        const running = runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "测试小说",
            loadPlan: async () => plan
        });
        await vi.waitFor(() => expect(mocks.selectionPopup).toHaveBeenCalledOnce());
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(readConcurrency).not.toHaveBeenCalled();
        expect(state.originalTitle).toBe("测试小说");
        expect(readImages.mock.invocationCallOrder[0]).toBeLessThan(mocks.getConflict.mock.invocationCallOrder[0]);
        expect(readImages.mock.invocationCallOrder[0]).toBeLessThan(mocks.previewCache.mock.invocationCallOrder[0]);

        selectionDecision.resolve({
            action: "download",
            selection: createRangeSelection(2, 3, 3)
        });
        await running;

        expect(mocks.getConflict).toHaveBeenCalledWith("100");
        expect(mocks.acquire).toHaveBeenCalledWith("100", "detail");
        expect(mocks.createDownloadPopup).toHaveBeenCalledWith("selected", expect.any(Function), "测试小说");
        expect(mocks.claimCache).toHaveBeenCalledWith("100", lock.taskId, false, expect.any(AbortSignal), {
            allowInvalidation: false,
            chapterSources: new Map([
                [1, "esj:100/2"],
                [2, "esj:100/3"]
            ])
        });
        expect(mocks.runDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                initialChapters: expect.any(Map),
                tasks: [tasks[1], tasks[2]],
                selection: { mode: "selected", sourceTotalChapters: 3, indexes: [1, 2] }
            }),
            expect.objectContaining({ cancellation: expect.any(Object) })
        );
        expect(readImages).toHaveBeenCalledOnce();
        expect(readConcurrency).toHaveBeenCalledOnce();
        expect(mocks.markRunning.mock.invocationCallOrder[0]).toBeLessThan(readConcurrency.mock.invocationCallOrder[0]);
        expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.showFormatChoice.mock.invocationCallOrder[0]
        );
        expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(mocks.claimCache.mock.invocationCallOrder[0]);
        expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(publishCacheSyncEvent).mock.invocationCallOrder[0]
        );
    });

    it("rejects a task acquired after a clear lock precheck", async () => {
        mocks.selectionPopup.mockResolvedValue({
            action: "download",
            selection: createRangeSelection(1, 2, 3)
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
        expect(mocks.release).not.toHaveBeenCalled();
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

        expect(recordBrowserPreflightDiagnosticFailure).toHaveBeenCalledOnce();
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.startHeartbeat).not.toHaveBeenCalled();
        expect(startBrowserDiagnosticSession).not.toHaveBeenCalled();
        expect(mocks.claimCache).not.toHaveBeenCalled();
        expect(mocks.release).not.toHaveBeenCalled();
    });
    it("retains a sparse selection and filename when incompatible cache requires confirmation again", async () => {
        const selection = { mode: "selected", sourceTotalChapters: 3, indexes: [0, 2] };
        mocks.selectionPopup
            .mockResolvedValueOnce({ action: "download", selection, filename: "选读" })
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

        expect(mocks.runDownload).not.toHaveBeenCalled();
        expect(mocks.release).toHaveBeenCalledOnce();
        expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(mocks.selectionPopup.mock.invocationCallOrder[1]);
        expect(mocks.selectionPopup).toHaveBeenLastCalledWith(
            expect.objectContaining({
                cacheWillBeInvalidated: true,
                cacheCount: 3,
                initialSelection: selection,
                initialFilename: "选读",
                tasks,
                directory: plan.directory
            })
        );
        expect(state.cachedData).toBe(old);
    });

    it("claims again with explicit invalidation consent after showing the changed cache", async () => {
        const selection = createRangeSelection(1, 3, 3);
        mocks.selectionPopup.mockResolvedValue({ action: "download", selection });
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
            allowInvalidation: false,
            chapterSources: expect.any(Map)
        });
        expect(mocks.claimCache).toHaveBeenNthCalledWith(2, "100", lock.taskId, false, expect.any(AbortSignal), {
            allowInvalidation: true,
            chapterSources: expect.any(Map)
        });
        expect(mocks.acquire).toHaveBeenCalledTimes(2);
        expect(mocks.release).toHaveBeenCalledTimes(2);
        expect(mocks.runDownload).toHaveBeenCalledOnce();
    });

    it("keeps the previous export available when the lock precheck cannot be read", async () => {
        const old = createCachedData();
        state.cachedData = old;
        const loadPlan = vi.fn(async () => plan);
        mocks.getConflict.mockRejectedValueOnce(new Error("lock read failed"));
        mocks.selectionPopup.mockResolvedValueOnce({ action: "open-existing" });

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan
        });

        expect(loadPlan).not.toHaveBeenCalled();
        expect(mocks.previewCache).not.toHaveBeenCalled();
        expect(recordBrowserPreflightDiagnosticFailure).toHaveBeenCalledWith(
            expect.objectContaining({ failure: expect.objectContaining({ scope: "storage", stage: "lock-read" }) })
        );
        expect(mocks.selectionPopup).toHaveBeenCalledWith(
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
        mocks.selectionPopup.mockResolvedValueOnce({ action: "open-existing" });

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan: async () => plan
        });

        expect(mocks.selectionPopup).toHaveBeenCalledWith(
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
        mocks.selectionPopup.mockResolvedValueOnce({
            action: "download",
            selection: createRangeSelection(1, 3, 3)
        });
        if (status === "failed") {
            mocks.runDownload.mockRejectedValueOnce(new Error("download failed"));
        } else {
            mocks.runDownload.mockResolvedValueOnce({ status: "cancelled", outcome: "saved" });
        }

        await runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: "Book",
            loadPlan: async () => plan
        });

        expect(state.cachedData).toBe(old);
        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
        expect(mocks.release).toHaveBeenCalledOnce();
    });
});
