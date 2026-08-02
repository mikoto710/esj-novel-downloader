// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { createDeferred, useFakeClock } from "../support";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

describe("browser download cancellation contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
    });

    it("passes the active abort signal to coordinator delays", async () => {
        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(mocks.sleepWithAbort).toHaveBeenCalled();
        expect(mocks.sleepWithAbort.mock.calls.every((call) => call[1] === runtime.state.abortController?.signal)).toBe(
            true
        );
    });

    it("does not fetch another chapter after cancellation reaches the retry queue", async () => {
        mocks.fetchWithTimeout.mockRejectedValue(new Error("network"));
        mocks.log.mockImplementation((message: string) => {
            if (message.startsWith("补抓 [")) {
                runtime.abortActiveDownload();
            }
        });

        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(3);
        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
    });

    it("does not persist a chapter cancelled during image processing", async () => {
        mocks.processHtmlImages.mockImplementationOnce(async () => {
            runtime.abortActiveDownload();
            return { processedHtml: "<p>未完成正文</p>", images: [], failCount: 0 };
        });

        await runtime.batchDownload({
            ...createBrowserDownloadOptions(createBrowserDownloadTasks(1)),
            imageEnabled: true
        });

        expect(runtime.state.globalChaptersMap.size).toBe(0);
        expect(mocks.saveCache).not.toHaveBeenCalled();
        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
    });

    it("aborts cache cleanup when cancellation arrives during export preparation", async () => {
        const clearStarted = createDeferred<void>();
        const clearAborted = createDeferred<void>();
        mocks.clearCache.mockImplementationOnce((_bookId, _taskId, signal?: AbortSignal) => {
            clearStarted.resolve();
            return new Promise<boolean>((resolve) => {
                signal?.addEventListener(
                    "abort",
                    () => {
                        clearAborted.resolve();
                        resolve(false);
                    },
                    { once: true }
                );
            });
        });

        const downloadPromise = runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await clearStarted.promise;
        runtime.abortActiveDownload();

        await clearAborted.promise;
        await downloadPromise;

        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
        expect(mocks.log.mock.calls.flat().join("\n")).toContain("进度已保存");
    });

    it("bounds cancellation while a cache write is pending", async () => {
        const clock = useFakeClock();
        const saveStarted = createDeferred<void>();
        const blockedSave = createDeferred<boolean>();
        mocks.saveCache
            .mockImplementationOnce((_bookId, _taskId, _entries, _meta, signal?: AbortSignal) => {
                saveStarted.resolve();
                signal?.addEventListener("abort", () => blockedSave.resolve(false), { once: true });
                return blockedSave.promise;
            })
            .mockResolvedValue(true);
        const downloadPromise = runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)));
        await saveStarted.promise;
        runtime.abortActiveDownload();
        runtime.abortActiveDownload();

        try {
            const outcome = Promise.race([
                downloadPromise.then(() => "settled" as const),
                new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 6_000))
            ]);
            await clock.advanceBy(6_000);
            await expect(outcome).resolves.toBe("settled");
            expect(mocks.saveCache).toHaveBeenCalledOnce();
            expect(mocks.fullCleanup).toHaveBeenCalledOnce();
            expect(mocks.log.mock.calls.flat().join("\n")).toContain("进度保存超时");
        } finally {
            blockedSave.resolve(true);
            await downloadPromise;
            clock.restore();
        }
    });

    it("aborts the active cache write immediately when cancellation discards progress", async () => {
        const saveStarted = createDeferred<void>();
        const writeAborted = createDeferred<void>();
        document.body.innerHTML = '<span id="esj-title"></span><button id="esj-cancel"></button>';
        mocks.saveCache.mockImplementationOnce((_bookId, _taskId, _entries, _meta, signal?: AbortSignal) => {
            saveStarted.resolve();
            return new Promise<boolean>((resolve) => {
                signal?.addEventListener(
                    "abort",
                    () => {
                        writeAborted.resolve();
                        resolve(false);
                    },
                    { once: true }
                );
            });
        });
        mocks.shouldDiscard.mockResolvedValue(true);

        const downloadPromise = runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)));
        await saveStarted.promise;
        runtime.abortActiveDownload();
        runtime.abortActiveDownload("discard");

        await writeAborted.promise;
        await downloadPromise;

        expect(mocks.saveCache).toHaveBeenCalledOnce();
        expect(mocks.log.mock.calls.flat().join("\n")).toContain("正在清理缓存");
        expect(document.querySelector("#esj-title")?.textContent).toBe("📘 任务已停止");
        expect(document.querySelector("#esj-cancel")?.textContent).toBe("已停止");
    });
});
