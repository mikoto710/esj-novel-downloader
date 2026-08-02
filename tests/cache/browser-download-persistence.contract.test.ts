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

        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(5)));

        const messages = mocks.log.mock.calls.flat().join("\n");
        expect(messages).not.toContain("进度已保存");
    });
});
