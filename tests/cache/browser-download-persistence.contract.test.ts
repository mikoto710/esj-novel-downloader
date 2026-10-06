// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { createDeferred } from "../support";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

describe("browser download persistence contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
    });

    it("applies cache backpressure before a worker claims another chapter", async () => {
        const writeStarted = createDeferred<void>();
        const writeFinished = createDeferred<boolean>();
        mocks.saveCache
            .mockImplementationOnce(() => {
                writeStarted.resolve();
                return writeFinished.promise;
            })
            .mockResolvedValue(true);

        const downloadPromise = runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(26)));
        await writeStarted.promise;

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(25);
        writeFinished.resolve(true);
        expect((await downloadPromise).status).toBe("ready");
        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(26);
    });

    it("does not claim that progress was saved after storage rejected the write", async () => {
        mocks.saveCache.mockResolvedValue(false);

        await expect(
            runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).rejects.toMatchObject({ reason: "ownership-lost", operation: "write" });

        expect(mocks.showTerminalFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "download",
                storageFailure: expect.objectContaining({ reason: "ownership-lost" })
            })
        );
        expect(runtime.task.cancellation.isCancellationRequested()).toBe(false);
        expect(mocks.saveCache).toHaveBeenCalledOnce();
    });

    it("retries an idempotent storage failure once and exposes the final reason", async () => {
        mocks.saveCache.mockRejectedValue(new DOMException("storage full", "QuotaExceededError"));

        await expect(
            runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).rejects.toMatchObject({ reason: "quota-exceeded", operation: "write" });

        expect(mocks.saveCache).toHaveBeenCalledTimes(2);
        expect(mocks.showTerminalFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "download",
                storageFailure: expect.objectContaining({ reason: "quota-exceeded" })
            })
        );
        expect(runtime.task.cancellation.isCancellationRequested()).toBe(false);
    });

    it.each([
        { name: "unexpected transaction abort", errorName: "AbortError", reason: "transaction-aborted" },
        {
            name: "database becoming unavailable during writing",
            errorName: "InvalidStateError",
            reason: "database-unavailable"
        }
    ])("fails after $name retries are exhausted without treating it as cancellation", async ({ errorName, reason }) => {
        mocks.saveCache.mockRejectedValue(new DOMException("storage write failed", errorName));

        await expect(
            runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).rejects.toMatchObject({ reason, operation: "write" });

        expect(mocks.saveCache).toHaveBeenCalledTimes(2);
        expect(mocks.showTerminalFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "download",
                storageFailure: expect.objectContaining({ reason, operation: "write" })
            })
        );
        expect(runtime.task.cancellation.isCancellationRequested()).toBe(false);
        expect(mocks.clearCache).not.toHaveBeenCalled();
    });

    it("propagates an unknown storage error after one safe retry", async () => {
        mocks.saveCache.mockRejectedValue(new Error("unexpected failure"));

        await expect(
            runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).rejects.toMatchObject({ reason: "unknown-storage-error", operation: "write" });

        expect(mocks.saveCache).toHaveBeenCalledTimes(2);
        expect(runtime.task.cancellation.isCancellationRequested()).toBe(false);
    });
});
