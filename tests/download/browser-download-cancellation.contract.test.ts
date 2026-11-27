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
        const diagnostics = await import("../../src/diagnostics/runtime");
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
            const blockedRequest = (_url: string, { signal }: RequestInit) => {
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
            const authRequest = vi.fn().mockResolvedValueOnce(new Response(createProtectedChapterFixture()));
            if (stage === "password") {
                authRequest.mockResolvedValueOnce(new Response("<JinJing>fictional-token</JinJing>"));
            }
            authRequest.mockImplementationOnce(blockedRequest);
            vi.stubGlobal("fetch", authRequest);

            const download = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));
            await requestStarted.promise;
            runtime.abortActiveDownload();
            runtime.abortActiveDownload();
            const result = await download;

            expect(result.status).toBe("cancelled");
            expect(mocks.fullCleanup).toHaveBeenCalledOnce();
            expect(mocks.closeProtectedChapterPrompt).toHaveBeenCalled();
            expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("never-log-this");
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

        expect(result).toMatchObject({ status: "cancelled", outcome: "saved" });
    });

    it.each(["write", "ownership", "close", "release"])("bounds a pending %s on cancellation", async (stage) => {
        const clock = useFakeClock();
        const saveStarted = createDeferred<void>();
        const save = createDeferred<boolean>();
        const owns = createDeferred<boolean>();
        const close = createDeferred<boolean>();
        const release = createDeferred<"released">();
        const writeAborted = vi.fn();
        mocks.saveCache.mockImplementationOnce((_bookId, _taskId, _entries, _meta, signal?: AbortSignal) => {
            signal?.addEventListener("abort", writeAborted, { once: true });
            saveStarted.resolve();
            return save.promise;
        });
        if (stage === "ownership") {
            mocks.ownsLock.mockImplementationOnce(() => owns.promise);
        }
        if (stage === "close") {
            mocks.finishCache.mockImplementationOnce(() => close.promise);
        }
        if (stage === "release") {
            mocks.release.mockImplementationOnce(() => release.promise);
        }
        const downloadPromise = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)));
        await saveStarted.promise;
        runtime.abortActiveDownload();
        if (stage !== "write") {
            // 收尾只剩首次取消期限内的时间
            await clock.advanceBy(1_000);
            save.resolve(true);
        }

        try {
            const finished = vi.fn();
            void downloadPromise.then(finished);
            await clock.advanceBy(stage === "write" ? 4_999 : 3_999);
            expect(finished).not.toHaveBeenCalled();
            if (stage === "ownership") {
                expect(mocks.ownsLock).toHaveBeenCalledOnce();
            }
            if (stage === "close") {
                expect(mocks.finishCache).toHaveBeenCalledOnce();
            }
            if (stage === "release") {
                expect(mocks.release).toHaveBeenCalledOnce();
            }
            await clock.advanceBy(1);
            expect(finished).toHaveBeenCalledOnce();
            if (stage === "write") {
                expect(writeAborted).toHaveBeenCalledOnce();
            }
            expect(mocks.clearCache).not.toHaveBeenCalled();
            expect(mocks.saveCache).toHaveBeenCalledOnce();
            expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
            expect(runtime.state.activeDownload).toBeNull();
            expect(mocks.fullCleanup).toHaveBeenCalledOnce();
            expect(mocks.showTerminalFailure).toHaveBeenCalledOnce();
            expect(mocks.showTerminalFailure).toHaveBeenCalledWith(
                expect.objectContaining({ kind: "cancellation", outcome: "save-timed-out" })
            );
            expect(mocks.fullCleanup.mock.invocationCallOrder[0]).toBeLessThan(
                mocks.showTerminalFailure.mock.invocationCallOrder[0]
            );
        } finally {
            save.resolve(true);
            owns.resolve(true);
            close.resolve(true);
            release.resolve("released");
            try {
                await clock.advanceBy(1_000);
                await downloadPromise;
            } finally {
                clock.restore();
            }
        }
    });

    it("accepts discard escalation after cancellation has started saving", async () => {
        const saveStarted = createDeferred<void>();
        const writeAborted = createDeferred<void>();
        mocks.sleepWithAbort.mockImplementation(async () => {
            if (runtime.state.runtimeCacheSession?.completedCount) runtime.abortActiveDownload("flush");
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
        expect(result).toMatchObject({ status: "cancelled", outcome: "discarded" });
    });

    it("reports failed cancellation saving without claiming progress was saved or clearing old cache", async () => {
        mocks.sleepWithAbort.mockImplementation(async () => {
            if (runtime.state.runtimeCacheSession?.completedCount) runtime.abortActiveDownload("flush");
        });
        mocks.saveCache.mockRejectedValue(new DOMException("storage full", "QuotaExceededError"));

        const result = await runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(result).toMatchObject({ status: "cancelled", outcome: "save-failed" });
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
        expect(result).toMatchObject({ status: "cancelled", outcome: "discarded" });

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
