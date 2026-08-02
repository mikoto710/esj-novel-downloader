// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

describe("browser download flow contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
    });

    it("shows saving, integrity, export preparation, and completion stages", async () => {
        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        const trayMessages = mocks.updateTrayText.mock.calls.flat();
        expect(trayMessages).toContain("正在保存下载进度 (1/1)");
        expect(trayMessages).toContain("正在检查章节完整性 (1/1)");
        expect(trayMessages).toContain("正在准备导出 (1/1)");
        expect(trayMessages).toContain("下载完成 (1/1)");
    });

    it("retries a missing chapter through the integrity queue", async () => {
        mocks.fetchWithTimeout
            .mockRejectedValueOnce(new Error("first"))
            .mockRejectedValueOnce(new Error("second"))
            .mockRejectedValueOnce(new Error("third"))
            .mockResolvedValue({ text: vi.fn().mockResolvedValue("<html></html>") });

        await runtime.batchDownload(createBrowserDownloadOptions(createBrowserDownloadTasks(1)));

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(4);
        expect(mocks.saveCache).toHaveBeenCalledOnce();
        expect(runtime.state.cachedData?.chapters).toHaveLength(1);
    });
});
