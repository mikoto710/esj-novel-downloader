// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createCachedData,
    useFakeClock,
    createDeferred,
    createChapterFixture,
    createProtectedChapterFixture,
    installDocumentFixture
} from "../support";

describe("full-book and single-chapter export isolation", () => {
    const alertMock = vi.fn();
    const clickMock = vi.fn();
    const createObjectUrlMock = vi.fn((blob: Blob) => {
        void blob;
        return "blob:single-chapter";
    });

    beforeEach(() => {
        vi.resetModules();
        vi.doUnmock("../../src/site/protected-chapter");
        vi.doUnmock("../../src/site/images");
        vi.doUnmock("../../src/storage/history");
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        const fixture = new DOMParser().parseFromString(createChapterFixture({ title: "单章测试" }), "text/html");
        installDocumentFixture(fixture);
        document.title = "单章测试 - ESJZone";
        const NativeURL = globalThis.URL;
        class TestURL extends NativeURL {
            static createObjectURL = createObjectUrlMock;
            static revokeObjectURL = vi.fn();
        }
        vi.stubGlobal("URL", TestURL);
        vi.stubGlobal("alert", alertMock);
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickMock);
    });

    it("preserves full-book data while single TXT waits for enabled image preparation", async () => {
        GM_setValue("enable_image_download", true);
        const images = createDeferred<Awaited<ReturnType<typeof import("../../src/site/images").processHtmlImages>>>();
        const processImages = vi.fn(() => images.promise);
        vi.doMock("../../src/site/images", () => ({ processHtmlImages: processImages }));
        const { state } = await import("../../src/app/page-session");
        const { downloadCurrentPage } = await import("../../src/app/single-download");
        const fullBookData = createCachedData();
        state.cachedData = fullBookData;

        const exporting = downloadCurrentPage("txt");
        await vi.waitFor(() => expect(processImages).toHaveBeenCalledOnce());
        expect(clickMock).not.toHaveBeenCalled();
        expect(state.cachedData).toBe(fullBookData);
        images.resolve({ processedHtml: "<p>正文</p>", images: [], failCount: 0, failures: [] });
        await exporting;

        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        const diagnostic = listBrowserDiagnosticSessions().history[0];

        expect(state.cachedData).toBe(fullBookData);
        expect(state.cachedData?.metadata.title).toBe("测试小说");
        expect(clickMock).toHaveBeenCalledOnce();
        expect(alertMock).not.toHaveBeenCalled();
        expect(diagnostic).toMatchObject({
            result: "success",
            book: { sourcePageType: "single" },
            task: { phase: "export-ready", totalChapters: 1, completedChapters: 1 },
            exports: [
                expect.objectContaining({
                    scope: "single",
                    format: "txt",
                    outcome: "success",
                    generated: true,
                    downloadTriggered: true
                })
            ]
        });
    });

    it("records an inline image failure without failing a single-chapter export", async () => {
        GM_setValue("enable_image_download", true);
        vi.doMock("../../src/site/images", () => ({
            processHtmlImages: vi.fn().mockResolvedValue({
                processedHtml: '<p>正文保留</p><img src="https://example.test/image.jpg">',
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
        }));

        const { downloadCurrentPage } = await import("../../src/app/single-download");
        await downloadCurrentPage("html");

        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        const diagnostic = listBrowserDiagnosticSessions().history[0];

        expect(clickMock).toHaveBeenCalledOnce();
        expect(diagnostic).toMatchObject({ result: "success", book: { sourcePageType: "single" } });
        expect(diagnostic.failures).toEqual([
            expect.objectContaining({
                scope: "image",
                imageFailureCount: 1,
                chapter: expect.objectContaining({ index: 1 })
            })
        ]);
    });

    it("records a failed single-chapter export in diagnostics", async () => {
        createObjectUrlMock.mockImplementationOnce(() => {
            throw new Error("object URL failed");
        });

        const { downloadCurrentPage } = await import("../../src/app/single-download");
        await downloadCurrentPage("txt");
        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        const diagnostic = listBrowserDiagnosticSessions().history[0];

        expect(diagnostic).toMatchObject({
            result: "failed",
            book: { sourcePageType: "single" },
            task: { phase: "failed", failedChapters: 1 }
        });
        expect(diagnostic.failures).toEqual([
            expect.objectContaining({ scope: "export", stage: "single-txt", message: "object URL failed" })
        ]);
        expect(diagnostic.exports).toEqual([
            expect.objectContaining({
                scope: "single",
                format: "txt",
                outcome: "failed",
                generated: true,
                downloadTriggered: false,
                failureStage: "download"
            })
        ]);
        expect(document.querySelector("#esj-message-diagnostic")).not.toBeNull();
    });

    it("awaits single history failure after immediate URL cleanup but retains triggered success", async () => {
        const history = createDeferred<void>();
        const addHistory = vi.fn(() => history.promise);
        vi.doMock("../../src/storage/history", () => ({ addDownloadHistory: addHistory }));
        const { downloadCurrentPage } = await import("../../src/app/single-download");
        let settled = false;
        const running = downloadCurrentPage("txt").then(() => {
            settled = true;
        });
        await vi.waitFor(() => expect(addHistory).toHaveBeenCalledOnce());
        expect(settled).toBe(false);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:single-chapter");
        expect(document.querySelector("a[download]")).toBeNull();
        history.reject(new Error("history unavailable"));
        await running;
        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        expect(listBrowserDiagnosticSessions().history[0]).toMatchObject({
            result: "failed",
            exports: [{ outcome: "success", generated: true, downloadTriggered: true, failureStage: null }]
        });
        expect(document.querySelector("#esj-message-popup")).not.toBeNull();
    });

    it("cleans a failed book click while retaining the 60-second URL lifetime", async () => {
        const { triggerDownload } = await import("../../src/browser/files");
        const clock = useFakeClock();
        const triggered = vi.fn();
        clickMock.mockImplementationOnce(() => {
            throw new Error("click failed");
        });
        try {
            expect(() => triggerDownload(new Blob(["book"]), "book.txt", { onTriggered: triggered })).toThrow(
                "click failed"
            );
            expect(triggered).not.toHaveBeenCalled();
            expect(document.querySelector("a[download]")).toBeNull();
            expect(URL.revokeObjectURL).not.toHaveBeenCalled();
            await clock.advanceBy(59_999);
            expect(URL.revokeObjectURL).not.toHaveBeenCalled();
            await clock.advanceBy(1);
            expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:single-chapter");
        } finally {
            clock.restore();
        }
    });

    it("retains the click marker and immediately revokes when single anchor removal fails", async () => {
        const removeChild = document.body.removeChild.bind(document.body);
        vi.spyOn(document.body, "removeChild").mockImplementation((node) => {
            removeChild(node);
            throw new Error("removal failed after detach");
        });
        const { downloadCurrentPage } = await import("../../src/app/single-download");
        await downloadCurrentPage("txt");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:single-chapter");
        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        expect(listBrowserDiagnosticSessions().history[0]).toMatchObject({
            result: "failed",
            exports: [{ outcome: "success", generated: true, downloadTriggered: true }]
        });
    });

    it("prompts for native unlock without exporting a protected single chapter", async () => {
        const fixture = new DOMParser().parseFromString(
            createProtectedChapterFixture({ title: "Protected chapter" }),
            "text/html"
        );
        installDocumentFixture(fixture);
        document.title = "Protected chapter - ESJZone";

        const [{ downloadCurrentPage }, { setInterfaceLocalePreference }] = await Promise.all([
            import("../../src/app/single-download"),
            import("../../src/storage/settings")
        ]);
        setInterfaceLocalePreference("zh-CN");
        await downloadCurrentPage("txt");

        expect(document.querySelector("#esj-protected-chapter")).toBeNull();
        expect(document.querySelector("#esj-message-popup")).not.toBeNull();
        expect(clickMock).not.toHaveBeenCalled();
    });
});
