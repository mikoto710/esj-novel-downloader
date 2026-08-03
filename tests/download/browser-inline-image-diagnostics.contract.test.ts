// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
    clearBrowserDiagnosticSessions,
    listBrowserDiagnosticSessions,
    startBrowserDiagnosticSession
} from "../../src/adapters/browser-diagnostics";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

function startDiagnosticSession(): void {
    startBrowserDiagnosticSession({
        taskId: "task-100",
        bookId: "100",
        bookTitle: "Image diagnostics",
        pageUrl: "https://www.esjzone.cc/detail/100.html",
        sourcePageType: "detail",
        imageEnabled: true
    });
}

describe("browser inline image diagnostic contracts", () => {
    beforeEach(async () => {
        clearBrowserDiagnosticSessions();
        runtime = await resetBrowserDownloadHarness();
    });

    it("retains a successful export after an image retry recovers", async () => {
        startDiagnosticSession();
        mocks.processHtmlImages
            .mockResolvedValueOnce({
                processedHtml: '<p>正文</p><img src="https://example.test/image.jpg">',
                images: [],
                failCount: 1,
                failures: [
                    {
                        stage: "request",
                        code: "image-request-failed",
                        message: "图片请求在重试后仍失败",
                        count: 1
                    }
                ]
            })
            .mockResolvedValueOnce({ processedHtml: "<p>正文</p>", images: [], failCount: 0, failures: [] });

        await runtime.batchDownload({
            ...createBrowserDownloadOptions(createBrowserDownloadTasks(1)),
            imageEnabled: true
        });

        const session = listBrowserDiagnosticSessions().history[0];
        expect(runtime.state.cachedData?.chapters[0]?.imageErrors).toBe(0);
        expect(session).toMatchObject({ result: "success", task: { phase: "export-ready" } });
        expect(session.failures).toEqual([
            expect.objectContaining({
                scope: "image",
                stage: "request",
                imageFailureCount: 1,
                chapter: expect.objectContaining({ index: 1 })
            })
        ]);
    });

    it("does not record an image failure when cancellation wins the processing race", async () => {
        startDiagnosticSession();
        mocks.processHtmlImages.mockImplementationOnce(async () => {
            runtime.abortActiveDownload();
            return {
                processedHtml: "<p>未完成正文</p>",
                images: [],
                failCount: 1,
                failures: [
                    {
                        stage: "request",
                        code: "image-request-failed",
                        message: "图片请求在重试后仍失败",
                        count: 1
                    }
                ]
            };
        });

        await runtime.batchDownload({
            ...createBrowserDownloadOptions(createBrowserDownloadTasks(1)),
            imageEnabled: true
        });

        const session = listBrowserDiagnosticSessions().history[0];
        expect(session).toMatchObject({ result: "cancelled", task: { phase: "cancelled" } });
        expect(session.failures).toEqual([]);
        expect(runtime.state.cachedData).toBeNull();
    });
});
