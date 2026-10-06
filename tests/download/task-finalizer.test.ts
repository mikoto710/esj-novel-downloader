// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createCachedData } from "../support";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;
const options = () => createBrowserDownloadOptions(createBrowserDownloadTasks(1));

describe("book download task finalization through the app entry", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
        mocks.shouldDiscard.mockResolvedValue(true);
        // End before the core: these faults belong to the app's acquired resources.
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
        await expect(runtime.start(options())).rejects.toThrow("heartbeat teardown");
        expect(mocks.release).toHaveBeenCalledWith(runtime.task.lock, { cacheDiscarded: true });
        expect(runtime.state.activeDownload).toBeNull();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
    });

    it("does not remove a newer handle when the old lock release fails", async () => {
        const { startRuntimeCacheSession } = await import("../../src/core/state");
        startRuntimeCacheSession(createCacheMeta(), runtime.task.lock.taskId, 1);
        const newer = { bookId: "200", taskId: "task-200", requestCancellation: vi.fn() };
        mocks.release.mockImplementationOnce(async () => {
            runtime.state.activeDownload = newer;
            throw new Error("release failed");
        });
        await expect(runtime.start(options())).rejects.toThrow("release failed");
        expect(runtime.state.activeDownload).toBe(newer);
        expect(runtime.state.runtimeCacheSession).toBeNull();
        expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
    });

    it("preserves the previous export when stopping and discarding a new task", async () => {
        const { startRuntimeCacheSession } = await import("../../src/core/state");
        const previous = createCachedData();
        runtime.state.cachedData = previous;
        startRuntimeCacheSession(createCacheMeta(), runtime.task.lock.taskId, 1);
        await runtime.start(options());
        expect(runtime.state.cachedData).toBe(previous);
        expect(runtime.state.runtimeCacheSession).toBeNull();
    });
});
