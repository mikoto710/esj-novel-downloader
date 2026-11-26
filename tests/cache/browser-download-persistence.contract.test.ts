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
        ).resolves.toMatchObject({
            status: "failed",
            failure: { kind: "download", storageFailure: { reason: "ownership-lost", operation: "write" } }
        });

        expect(mocks.showTerminalFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "download",
                storageFailure: expect.objectContaining({ reason: "ownership-lost" })
            })
        );
        expect(runtime.task.cancellation.isCancellationRequested()).toBe(false);
        expect(mocks.saveCache).toHaveBeenCalledOnce();
    });

    it.each([
        { error: new DOMException("storage full", "QuotaExceededError"), reason: "quota-exceeded" },
        { error: new DOMException("unexpected abort", "AbortError"), reason: "transaction-aborted" },
        { error: new DOMException("database disabled", "InvalidStateError"), reason: "database-unavailable" },
        { error: new Error("unexpected failure"), reason: "unknown-storage-error" }
    ])("retries $reason once and reports terminal failure without cancelling", async ({ error, reason }) => {
        mocks.saveCache.mockRejectedValue(error);

        await expect(
            runtime.runBookDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).resolves.toMatchObject({
            status: "failed",
            failure: { kind: "download", storageFailure: { reason, operation: "write" } }
        });
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
});
