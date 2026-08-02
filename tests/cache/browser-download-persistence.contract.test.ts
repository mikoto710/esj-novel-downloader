// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { createChapter, createDeferred } from "../support";
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

    it("does not fetch chapters already restored from cache", async () => {
        const tasks = createBrowserDownloadTasks(3);
        runtime.state.globalChaptersMap = new Map(tasks.map((task) => [task.index, createChapter(task.index)]));

        await runtime.batchDownload(createBrowserDownloadOptions(tasks));

        expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
        expect(mocks.saveCache).not.toHaveBeenCalled();
        expect(mocks.clearCache).toHaveBeenCalledOnce();
        expect(runtime.state.cachedData?.chapters).toHaveLength(3);
        expect(mocks.showFormatChoice).toHaveBeenCalledOnce();
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

        const downloadPromise = runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(26)));
        await writeStarted.promise;

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(25);
        writeFinished.resolve(true);
        await downloadPromise;
        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(26);
    });

    it("does not repeat a whole-book save after cancellation", async () => {
        mocks.saveCache.mockImplementationOnce(async () => {
            runtime.abortActiveDownload();
            return true;
        });

        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)));

        expect(mocks.saveCache).toHaveBeenCalledTimes(1);
    });

    it("does not claim that progress was saved after storage rejected the write", async () => {
        mocks.saveCache.mockResolvedValue(false);

        await expect(
            runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).rejects.toMatchObject({ reason: "ownership-lost", operation: "write" });

        const messages = mocks.log.mock.calls.flat().join("\n");
        expect(messages).not.toContain("进度已保存");
        expect(messages).toContain("下载进度未保存");
        expect(runtime.state.abortFlag).toBe(false);
        expect(mocks.saveCache).toHaveBeenCalledOnce();
    });

    it("retries an idempotent storage failure once and exposes the final reason", async () => {
        mocks.saveCache.mockRejectedValue(new DOMException("storage full", "QuotaExceededError"));

        await expect(
            runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).rejects.toMatchObject({ reason: "quota-exceeded", operation: "write" });

        expect(mocks.saveCache).toHaveBeenCalledTimes(2);
        expect(mocks.log).toHaveBeenCalledWith(expect.stringContaining("正在进行一次安全重试"));
        expect(mocks.log).toHaveBeenCalledWith(expect.stringContaining("浏览器存储空间不足"));
        expect(runtime.state.abortFlag).toBe(false);
    });

    it.each([
        {
            name: "transaction abort",
            error: new DOMException("transaction aborted", "AbortError"),
            reason: "transaction-aborted"
        },
        {
            name: "unavailable database",
            error: new DOMException("database disabled", "InvalidStateError"),
            reason: "database-unavailable"
        },
        { name: "unknown storage error", error: new Error("unexpected failure"), reason: "unknown-storage-error" }
    ])("propagates $name after one safe retry", async ({ error, reason }) => {
        mocks.saveCache.mockRejectedValue(error);

        await expect(
            runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)))
        ).rejects.toMatchObject({ reason, operation: "write" });

        expect(mocks.saveCache).toHaveBeenCalledTimes(2);
        expect(runtime.state.abortFlag).toBe(false);
    });
});
