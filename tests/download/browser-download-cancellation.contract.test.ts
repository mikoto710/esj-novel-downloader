// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred, useFakeClock } from "../support";
import { createProtectedChapterFixture } from "../support/fixtures";
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

    it("does not request a claimed integrity retry when cancellation arrives before its fetch", async () => {
        const diagnostics = await import("../../src/adapters/browser-diagnostics");
        const browserDiagnosticLog = diagnostics.browserDiagnosticLog;
        let reachedIntegrityRetry = false;
        mocks.fetchWithTimeout.mockRejectedValue(new Error("network"));
        vi.spyOn(diagnostics, "browserDiagnosticLog").mockImplementation((message, ...args) => {
            browserDiagnosticLog(message, ...args);
            if (typeof message !== "string" && message.code === "chapter-integrity-retry") {
                reachedIntegrityRetry = true;
                runtime.abortActiveDownload();
            }
        });

        const result = await runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(reachedIntegrityRetry).toBe(true);
        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(3);
        expect(result.status).toBe("cancelled");
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
        expect(mocks.showTerminalFailure).not.toHaveBeenCalled();
    });

    it.each(["token", "password"] as const)(
        "settles repeated cancellation during the protected chapter %s request",
        async (stage) => {
            const requestStarted = createDeferred<void>();
            const blockedRequest = (_url: string, _options: RequestInit, _timeout: number, signal?: AbortSignal) => {
                requestStarted.resolve();
                return new Promise<never>((_resolve, reject) => {
                    signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), {
                        once: true
                    });
                });
            };
            mocks.promptProtectedChapterPassword.mockResolvedValue({
                action: "submit",
                password: "never-log-this",
                rememberPassword: false
            });
            mocks.fetchWithTimeout.mockResolvedValueOnce({
                text: vi.fn().mockResolvedValue(createProtectedChapterFixture())
            });
            mocks.fetchWithTimeout.mockResolvedValueOnce({
                text: vi.fn().mockResolvedValue(createProtectedChapterFixture())
            });
            if (stage === "password") {
                mocks.fetchWithTimeout.mockResolvedValueOnce({
                    text: vi.fn().mockResolvedValue("<JinJing>fictional-token</JinJing>")
                });
            }
            mocks.fetchWithTimeout.mockImplementationOnce(blockedRequest);

            const download = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
            await requestStarted.promise;
            runtime.abortActiveDownload();
            runtime.abortActiveDownload();
            const result = await download;

            expect(result.status).toBe("cancelled");
            expect(mocks.fullCleanup).toHaveBeenCalledOnce();
            expect(mocks.closeProtectedChapterPrompt).toHaveBeenCalled();
            expect(mocks.log.mock.calls.flat().join("\n")).not.toContain("never-log-this");
        }
    );

    it("does not persist a chapter cancelled during image processing", async () => {
        mocks.processHtmlImages.mockImplementationOnce(async () => {
            runtime.abortActiveDownload();
            return { processedHtml: "<p>未完成正文</p>", images: [], failCount: 0, failures: [] };
        });

        const result = await runtime.runBookDownload({
            ...createBrowserDownloadOptions(createBrowserDownloadTasks(1)),
            imageEnabled: true
        });

        expect(runtime.task.chapters.size).toBe(0);
        expect(mocks.saveCache).not.toHaveBeenCalled();
        expect(result.status).toBe("cancelled");
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

        const downloadPromise = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await clearStarted.promise;
        runtime.abortActiveDownload();

        await clearAborted.promise;
        const result = await downloadPromise;

        expect(result).toEqual({ status: "cancelled", outcome: "saved" });
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
        const downloadPromise = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)));
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
            expect(mocks.showTerminalFailure).toHaveBeenCalledOnce();
            expect(mocks.showTerminalFailure).toHaveBeenCalledWith(
                expect.objectContaining({ kind: "cancellation", outcome: "save-timed-out" })
            );
            expect(mocks.fullCleanup.mock.invocationCallOrder[0]).toBeLessThan(
                mocks.showTerminalFailure.mock.invocationCallOrder[0]
            );
        } finally {
            blockedSave.resolve(true);
            await downloadPromise;
            clock.restore();
        }
    });

    it("accepts discard escalation after cancellation has started saving", async () => {
        const saveStarted = createDeferred<void>();
        const writeAborted = createDeferred<void>();
        mocks.sleepWithAbort.mockImplementation(async () => {
            if (runtime.task.chapters.size > 0) runtime.abortActiveDownload("flush");
        });
        mocks.saveCache.mockImplementationOnce((_bookId, _taskId, _entries, _meta, signal?: AbortSignal) => {
            saveStarted.resolve();
            return new Promise<boolean>((resolve) =>
                signal?.addEventListener(
                    "abort",
                    () => {
                        writeAborted.resolve();
                        resolve(false);
                    },
                    { once: true }
                )
            );
        });

        const download = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await saveStarted.promise;
        expect(mocks.shouldDiscard).toHaveBeenCalledOnce();
        runtime.abortActiveDownload("discard");
        await writeAborted.promise;
        const result = await download;

        expect(mocks.saveCache).toHaveBeenCalledOnce();
        expect(mocks.showTerminalFailure).not.toHaveBeenCalled();
        expect(result).toEqual({ status: "cancelled", outcome: "discarded" });
    });

    it("reports failed cancellation saving without claiming progress was saved or clearing old cache", async () => {
        mocks.sleepWithAbort.mockImplementation(async () => {
            if (runtime.task.chapters.size > 0) runtime.abortActiveDownload("flush");
        });
        mocks.saveCache.mockRejectedValue(new DOMException("storage full", "QuotaExceededError"));

        const result = await runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(result).toEqual({ status: "cancelled", outcome: "save-failed" });
        expect(mocks.showTerminalFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "cancellation",
                outcome: "save-failed",
                storageFailure: expect.objectContaining({ reason: "quota-exceeded", operation: "write" })
            })
        );
        expect(mocks.clearCache).not.toHaveBeenCalled();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
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

        const downloadPromise = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)));
        await saveStarted.promise;
        runtime.abortActiveDownload();
        runtime.abortActiveDownload("discard");

        await writeAborted.promise;
        const result = await downloadPromise;
        expect(result).toEqual({ status: "cancelled", outcome: "discarded" });

        expect(mocks.saveCache).toHaveBeenCalledOnce();
        expect(document.querySelector<HTMLButtonElement>("#esj-cancel")?.disabled).toBe(true);
    });
    it("keeps production cancellation isolated and only allows discard upgrades", async () => {
        const entered = createDeferred<void>();
        const finish = createDeferred<void>();
        mocks.runDownload.mockImplementation(async () => {
            entered.resolve();
            await finish.promise;
            return { status: "cancelled", outcome: "saved" };
        });
        const firstRun = runtime.start(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
        await entered.promise;
        const first = runtime.task.cancellation;
        const listener = vi.fn();
        const unsubscribe = first.subscribeCancellation(listener);
        first.requestCancellation("flush");
        first.requestCancellation("flush");
        first.requestCancellation("discard");
        first.requestCancellation("flush");
        expect(first.mode).toBe("discard");
        expect(listener.mock.calls).toEqual([["flush"], ["discard"]]);
        unsubscribe();
        mocks.acquire.mockResolvedValueOnce({
            acquired: true,
            lock: { ...runtime.task.lock, bookId: "200", taskId: "task-200" }
        });
        const secondRun = runtime.start({
            ...createBrowserDownloadOptions(createBrowserDownloadTasks(1)),
            bookId: "200"
        });
        await vi.waitFor(() => expect(mocks.runDownload).toHaveBeenCalledTimes(2));
        const second = runtime.task.cancellation;
        expect(runtime.state.activeDownload?.taskId).toBe("task-200");
        expect(second.isCancellationRequested()).toBe(false);
        expect(second.signal).not.toBe(first.signal);
        first.requestCancellation("discard");
        expect(second.isCancellationRequested()).toBe(false);
        runtime.abortActiveDownload();
        expect(second.isCancellationRequested()).toBe(true);
        finish.resolve();
        await Promise.all([firstRun, secondRun]);
    });
});
