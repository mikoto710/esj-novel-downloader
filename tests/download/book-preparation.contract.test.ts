// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserDownloadMocks, resetBrowserDownloadHarness } from "../support/browser-download-harness";
import { runBookDownload } from "../../src/app/book-download";
import { loadDetailBook, loadForumBook, type PreparedBook } from "../../src/site/book";
import { listBrowserDiagnosticSessions } from "../../src/diagnostics/runtime";
import {
    createCachedData,
    createDeferred,
    createDetailPageFixture,
    installDocumentFixture,
    useFakeClock
} from "../support";

const mocks = getBrowserDownloadMocks();
let selection: typeof import("../../src/ui/dialogs/download-selection");

describe("book preparation lifetime", () => {
    beforeEach(async () => {
        await resetBrowserDownloadHarness();
        selection = await vi.importActual<typeof import("../../src/ui/dialogs/download-selection")>(
            "../../src/ui/dialogs/download-selection"
        );
        mocks.selectionView.mockImplementation(selection.createDownloadSelectionPopup);
        window.history.replaceState({}, "", "/detail/100.html");
        installDocumentFixture(createDetailPageFixture({ chapterCount: 4 }));
    });

    it("shows a cancellable window while the directory is still pending", async () => {
        const entered = createDeferred<void>();
        const directory = createDeferred<PreparedBook>();
        let signal: AbortSignal | undefined;
        const running = runBookDownload({
            bookId: "100",
            sourcePageType: "forum",
            pageTitle: document.title,
            loadPlan: (currentSignal) => {
                signal = currentSignal;
                entered.resolve();
                return directory.promise;
            }
        });
        try {
            await entered.promise;
            const cancel = document.querySelector<HTMLButtonElement>("#esj-range-cancel");
            expect(cancel).not.toBeNull();
            cancel?.click();
            await running;
            expect(signal?.aborted).toBe(true);
            expect(directory.settled).toBe(false);
            expect(mocks.acquire).not.toHaveBeenCalled();
            expect(document.querySelector("#esj-range-selection")).toBeNull();
        } finally {
            directory.reject(new DOMException("Cancelled", "AbortError"));
            document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
            await running.catch(() => undefined);
        }
    });

    it("opens the previous export without waiting for a late cache failure", async () => {
        const { state } = await import("../../src/app/page-session");
        const previous = createCachedData();
        state.cachedData = previous;
        const cache =
            createDeferred<Awaited<ReturnType<typeof import("../../src/storage/cache/book-cache").previewBookCache>>>();
        const entered = createDeferred<void>();
        mocks.previewCache.mockImplementation(() => {
            entered.resolve();
            return cache.promise;
        });
        const running = runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: document.title,
            loadPlan: async () => loadDetailBook(document, location.href)
        });
        try {
            await entered.promise;
            const open = document.querySelector<HTMLButtonElement>("#esj-range-open-previous");
            expect(open).not.toBeNull();
            open?.click();
            await running;
            expect(cache.settled).toBe(false);
            expect(mocks.showFormatChoice).toHaveBeenCalledWith(previous);
            expect(state.cachedData).toBe(previous);

            const next = selection.createDownloadSelectionPopup({
                tasks: [],
                cachedIndexes: new Set(),
                cacheCount: 0,
                cacheWillBeInvalidated: false,
                imageEnabled: false,
                hasExistingExport: false,
                preparationStage: "reading-book"
            });
            const element = document.querySelector("#esj-range-selection");
            cache.reject(new Error("late cache failure"));
            await Promise.resolve();
            await Promise.resolve();
            expect(document.querySelector("#esj-range-selection")).toBe(element);
            expect(listBrowserDiagnosticSessions().history).toHaveLength(0);
            expect(mocks.acquire).not.toHaveBeenCalled();
            next.close();
            await next.decision;
        } finally {
            cache.reject(new Error("cleanup"));
            await running.catch(() => undefined);
        }
    });

    it("keeps a timed-out forum preparation outside the book lock", async () => {
        const clock = useFakeClock();
        const fetching = createDeferred<void>();
        const request = createDeferred<Response>();
        vi.stubGlobal(
            "fetch",
            vi.fn(() => {
                fetching.resolve();
                return request.promise;
            })
        );
        const running = runBookDownload({
            bookId: "100",
            sourcePageType: "forum",
            pageTitle: document.title,
            loadPlan: (signal) => loadForumBook("100", location.origin, signal)
        });
        try {
            await fetching.promise;
            await clock.advanceBy(15000);
            expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(true);
            expect(mocks.acquire).not.toHaveBeenCalled();
            expect(listBrowserDiagnosticSessions().history[0].failures[0].code).toBe("detail-fetch-timeout");
            document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
            await running;
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            request.reject(new DOMException("Cancelled", "AbortError"));
            document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
            await running.catch(() => undefined);
            clock.restore();
        }
    });

    it("prepares the detail document without fetching and starts only the selected absolute indexes", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        mocks.runDownload.mockResolvedValueOnce({ status: "ready", data: createCachedData() });
        const running = runBookDownload({
            bookId: "100",
            sourcePageType: "detail",
            pageTitle: document.title,
            loadPlan: async () => loadDetailBook(document, location.href)
        });
        await vi.waitFor(() =>
            expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(false)
        );
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.acquire).not.toHaveBeenCalled();
        document.querySelector<HTMLInputElement>("#esj-download-range")?.click();
        document.querySelector<HTMLInputElement>("#esj-range-start")!.value = "2";
        const end = document.querySelector<HTMLInputElement>("#esj-range-end")!;
        end.value = "3";
        end.dispatchEvent(new Event("input"));
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await running;
        expect(mocks.runDownload.mock.calls[0][0].tasks.map((task: { index: number }) => task.index)).toEqual([1, 2]);
        expect(mocks.claimCache).toHaveBeenCalledOnce();
        expect(mocks.release).toHaveBeenCalledOnce();
    });
});
