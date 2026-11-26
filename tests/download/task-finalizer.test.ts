// @vitest-environment jsdom

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createCachedData, createDeferred } from "../support";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";
import { deleteTestDatabase } from "../support/resources";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;
const options = () => createBrowserDownloadOptions(createBrowserDownloadTasks(1));

async function listDiagnostics() {
    const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
    return listBrowserDiagnosticSessions();
}

afterAll(async () => {
    await listDiagnostics();
    await deleteTestDatabase("esj-novel-downloader-diagnostics");
});

describe("book download task finalization through the app entry", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
        mocks.shouldDiscard.mockResolvedValue(true);
        // 在进入下载核心前注入故障，验证应用层已取得资源的收尾
        mocks.claimCache.mockImplementation(async () => {
            runtime.abortActiveDownload("discard");
            throw new DOMException("cancelled claim", "AbortError");
        });
    });

    it("reports cache clear rejection while still releasing the task lock", async () => {
        mocks.clearCache.mockRejectedValueOnce(new DOMException("transaction aborted", "AbortError"));
        await runtime.start(options());
        expect(mocks.showCacheDiscardFailure).toHaveBeenCalledWith(
            expect.objectContaining({ reason: "transaction-aborted", operation: "clear" })
        );
        expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
        expect(mocks.release).toHaveBeenCalledWith(runtime.task.lock, { cacheDiscarded: false });
        expect(runtime.state.activeDownload).toBeNull();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
    });

    it("reports ownership loss when the writer declines cache deletion", async () => {
        mocks.clearCache.mockResolvedValueOnce(false);
        await runtime.start(options());
        expect(mocks.showCacheDiscardFailure).toHaveBeenCalledWith(
            expect.objectContaining({ reason: "ownership-lost", operation: "clear" })
        );
        expect(mocks.release).toHaveBeenCalledWith(runtime.task.lock, { cacheDiscarded: false });
        expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
        expect(runtime.state.activeDownload).toBeNull();
    });

    it("releases ownership even when heartbeat teardown throws", async () => {
        mocks.stopHeartbeat.mockImplementationOnce(() => {
            throw new Error("heartbeat teardown");
        });
        await runtime.start(options());
        expect(mocks.release).toHaveBeenCalledWith(runtime.task.lock, { cacheDiscarded: true });
        expect(runtime.state.activeDownload).toBeNull();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
    });

    it("does not remove a newer handle when the old lock release fails", async () => {
        const { startRuntimeCacheSession } = await import("../../src/app/page-session");
        startRuntimeCacheSession(createCacheMeta(), runtime.task.lock.taskId, 1);
        const newer = { bookId: "200", taskId: "task-200", requestCancellation: vi.fn() };
        mocks.release.mockImplementationOnce(async () => {
            runtime.state.activeDownload = newer;
            throw new Error("release failed");
        });
        await runtime.start(options());
        expect(runtime.state.activeDownload).toBe(newer);
        expect(runtime.state.runtimeCacheSession).toBeNull();
        expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
    });

    it("preserves the previous export when stopping and discarding a new task", async () => {
        const { startRuntimeCacheSession } = await import("../../src/app/page-session");
        const previous = createCachedData();
        runtime.state.cachedData = previous;
        startRuntimeCacheSession(createCacheMeta(), runtime.task.lock.taskId, 1);
        await runtime.start(options());
        expect(runtime.state.cachedData).toBe(previous);
        expect(runtime.state.runtimeCacheSession).toBeNull();
    });
});

describe("completed book results at cleanup", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
        const { clearBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        await clearBrowserDiagnosticSessions();
    });

    it.each([undefined, "clear", "release"] as const)(
        "keeps the completed export and diagnostic after %s",
        async (step) => {
            const { showMessagePopup } = await import("../../src/ui/dialogs/message");
            if (step) {
                const operation = step === "clear" ? mocks.clearCache : mocks.release;
                operation.mockRejectedValueOnce(new DOMException("storage unavailable", "InvalidStateError"));
            }

            await runtime.start(options());

            expect(runtime.state.cachedData?.chapters).toHaveLength(1);
            expect(mocks.showFormatChoice).toHaveBeenCalledWith(runtime.state.cachedData);
            if (step) {
                expect(showMessagePopup).toHaveBeenCalledWith(expect.objectContaining({ tone: "warning" }));
            } else {
                expect(showMessagePopup).not.toHaveBeenCalled();
            }
            expect(runtime.state.activeDownload).toBeNull();
            expect((await listDiagnostics()).history[0]).toMatchObject({
                taskId: runtime.task.lock.taskId,
                result: "success",
                task: { phase: "export-ready", completedChapters: 1 }
            });
        }
    );

    it("removes a failed task summary while retaining the previous export", async () => {
        const previous = createCachedData();
        runtime.state.cachedData = previous;
        mocks.saveCache.mockRejectedValue(new DOMException("full", "QuotaExceededError"));
        await runtime.start(options());
        expect(runtime.state.runtimeCacheSession).toBeNull();
        expect(runtime.state.cachedData).toBe(previous);
        expect(mocks.showTerminalFailure).toHaveBeenCalled();
        expect((await listDiagnostics()).history[0]).toMatchObject({
            taskId: runtime.task.lock.taskId,
            result: "failed",
            task: { phase: "failed" }
        });
    });

    it("honors a remote discard accepted during finalization", async () => {
        const previous = createCachedData();
        runtime.state.cachedData = previous;
        const releaseStarted = createDeferred<void>();
        const releaseVerdict = createDeferred<"discard-requested">();
        mocks.release
            .mockImplementationOnce(async () => {
                releaseStarted.resolve();
                return releaseVerdict.promise;
            })
            .mockResolvedValueOnce("released");
        const completing = runtime.start(options());
        await releaseStarted.promise;
        let pending;
        const newerTaskId = "task-after-finalization";
        const { startBrowserDiagnosticSession, browserDiagnosticLog } = await import("../../src/diagnostics/runtime");
        try {
            pending = await listDiagnostics();
            startBrowserDiagnosticSession({
                taskId: newerTaskId,
                bookId: "200",
                bookTitle: "Newer Book",
                pageUrl: "https://www.esjzone.cc/detail/200.html",
                sourcePageType: "detail",
                imageEnabled: false
            });
        } finally {
            releaseVerdict.resolve("discard-requested");
            await completing;
        }
        expect(mocks.release).toHaveBeenNthCalledWith(2, runtime.task.lock, { cacheDiscarded: true });
        expect(runtime.state.cachedData).toBe(previous);
        expect(runtime.state.runtimeCacheSession).toBeNull();
        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
        browserDiagnosticLog("Newer task still running", undefined, false);
        const diagnosed = await listDiagnostics();
        expect(diagnosed.history[0]).toMatchObject({
            taskId: runtime.task.lock.taskId,
            result: "cancelled",
            task: { phase: "cancelled", completedChapters: 1 }
        });
        expect(diagnosed.active[0]).toMatchObject({
            taskId: newerTaskId,
            result: "running",
            logs: [{ message: "Newer task still running" }]
        });
        expect(pending.active[0]).toMatchObject({
            taskId: runtime.task.lock.taskId,
            result: "running",
            task: { phase: "preparing-export" }
        });
    });

    it("keeps the previous export when the task has lost its lock", async () => {
        const previous = createCachedData();
        runtime.state.cachedData = previous;
        mocks.release.mockResolvedValueOnce("ownership-lost");
        await runtime.start(options());
        expect(runtime.state.cachedData).toBe(previous);
        expect(mocks.showTerminalFailure).toHaveBeenCalledWith(expect.objectContaining({ outcome: "ownership-lost" }));
        expect((await listDiagnostics()).history[0]).toMatchObject({
            taskId: runtime.task.lock.taskId,
            result: "failed",
            task: { phase: "failed", completedChapters: 1 }
        });
    });
});
