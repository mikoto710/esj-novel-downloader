// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createCachedData,
    useFakeClock,
    createDeferred,
    createChapterFixture,
    createDetailPageFixture,
    createProtectedChapterFixture,
    installDocumentFixture
} from "../support";
import { deleteTestDatabase } from "../support/resources";

describe("full-book and single-chapter export isolation", () => {
    const clickMock = vi.fn();
    const createObjectUrlMock = vi.fn((blob: Blob) => {
        void blob;
        return "blob:single-chapter";
    });

    beforeEach(() => {
        vi.resetModules();
        vi.doUnmock("../../src/site/images");
        vi.doUnmock("../../src/storage/history");
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        const fixture = new DOMParser().parseFromString(createChapterFixture({ title: "单章测试" }), "text/html");
        installDocumentFixture(fixture);
        const NativeURL = globalThis.URL;

        class TestURL extends NativeURL {
            static createObjectURL = createObjectUrlMock;
            static revokeObjectURL = vi.fn();
        }

        vi.stubGlobal("URL", TestURL);
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickMock);
    });

    afterEach(async () => {
        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        await listBrowserDiagnosticSessions();
        await deleteTestDatabase("esj-novel-downloader-diagnostics");
    });

    it("preserves full-book data without requesting or encoding images for single TXT", async () => {
        GM_setValue("enable_image_download", true);
        document.querySelector(".forum-content")!.innerHTML = '<p>正文</p><img src="https://example.test/image.jpg">';
        const processImages = vi.fn().mockResolvedValue({ processedHtml: "", images: [], failCount: 0, failures: [] });
        vi.doMock("../../src/site/images", () => ({ processHtmlImages: processImages }));
        const encodeImage = vi.spyOn(FileReader.prototype, "readAsDataURL");
        const { state } = await import("../../src/app/page-session");
        const { downloadCurrentPage } = await import("../../src/app/single-download");
        const fullBookData = createCachedData();
        state.cachedData = fullBookData;

        await downloadCurrentPage("txt");

        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        const diagnostic = (await listBrowserDiagnosticSessions()).history[0];

        expect(state.cachedData).toBe(fullBookData);
        expect(state.cachedData?.metadata.title).toBe("测试小说");
        expect(processImages).not.toHaveBeenCalled();
        expect(encodeImage).not.toHaveBeenCalled();
        expect(clickMock).toHaveBeenCalledOnce();
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

    it.each([
        ["<p>单章测试</p>\n<p>第一行<br>第二行</p>\n<div>最后一行</div>", "第一行\n第二行\n最后一行"],
        ["<p>单章测试的开头</p>\n<p>正文</p>", "单章测试的开头\n正文"]
    ])("exports complete TXT lines from %s", async (content, expected) => {
        document.querySelector(".forum-content")!.innerHTML = content;
        const { downloadCurrentPage } = await import("../../src/app/single-download");

        await downloadCurrentPage("txt");

        expect(await createObjectUrlMock.mock.calls[0][0].text()).toMatch(new RegExp(`\\n\\n${expected}$`));
    });

    it.each([
        ["txt", "chapter-login-page"],
        ["html", "chapter-login-page"],
        ["txt", "chapter-content-missing"],
        ["html", "chapter-content-missing"]
    ] as const)("reports an invalid chapter without generating %s (%s)", async (format, code) => {
        const body = document.querySelector(".forum-content")!;
        if (code === "chapter-login-page") {
            body.remove();
            document.body.insertAdjacentHTML(
                "beforeend",
                '<form class="login-box"><input type="email" name="email"><input type="password" name="pwd"></form>'
            );
        } else {
            body.innerHTML = "<p> \n <br></p>";
        }
        const { downloadCurrentPage } = await import("../../src/app/single-download");
        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");

        await downloadCurrentPage(format);

        expect(createObjectUrlMock).not.toHaveBeenCalled();
        expect(document.querySelector("#esj-message-popup")).not.toBeNull();
        expect((await listBrowserDiagnosticSessions()).history[0].failures).toMatchObject([{ stage: "parse", code }]);
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
        const diagnostic = (await listBrowserDiagnosticSessions()).history[0];

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

    it.each([false, true])("exports image-only HTML with image downloads set to %s", async (imageEnabled) => {
        GM_setValue("enable_image_download", imageEnabled);
        document.querySelector(".forum-content")!.innerHTML = '<img src="https://example.test/image.jpg">';
        const processImages = vi.fn().mockResolvedValue({
            processedHtml: '<img src="img_0_0.jpg" alt="插图">',
            images: [{ id: "img_0_0.jpg", mediaType: "image/jpeg", blob: new Blob(["image"], { type: "image/jpeg" }) }],
            failCount: 0,
            failures: []
        });
        vi.doMock("../../src/site/images", async (importOriginal) => ({
            ...(await importOriginal<typeof import("../../src/site/images")>()),
            processHtmlImages: processImages
        }));
        const { downloadCurrentPage } = await import("../../src/app/single-download");

        await downloadCurrentPage("html");

        expect(processImages).toHaveBeenCalledTimes(imageEnabled ? 1 : 0);
        const html = await createObjectUrlMock.mock.calls[0][0].text();
        expect(html.includes("<img")).toBe(imageEnabled);
        expect(html.includes("data:image/jpeg;base64,")).toBe(imageEnabled);
    });

    it.each([200, 404])("uses the replacement chapter navigation link for detail metadata (%s)", async (status) => {
        document.body.insertAdjacentHTML(
            "beforeend",
            `<nav class="entry-navigation">
                <a id="btn-download-single" class="view-all">TXT</a>
                <a id="btn-download-single-html" class="view-all">HTML</a>
                <a class="view-all" href="/detail/432.html">详情</a>
            </nav>`
        );
        const detail = createDetailPageFixture({ bookName: "原书: 一/二" });
        const fetchDetail = vi.fn().mockResolvedValue(new Response(detail.documentElement.outerHTML, { status }));
        vi.stubGlobal("fetch", fetchDetail);
        const addDownloadHistory = vi.fn().mockResolvedValue(undefined);
        vi.doMock("../../src/storage/history", () => ({ addDownloadHistory }));
        document.querySelector(".forum-content")?.insertAdjacentHTML("beforeend", '<a href="3.html">下章</a>');
        const { downloadCurrentPage } = await import("../../src/app/single-download");

        await downloadCurrentPage("html");

        const html = await createObjectUrlMock.mock.calls[0][0].text();
        expect(html).toContain("章节正文");
        expect(html).toContain('href="https://www.esjzone.cc/forum/1/3.html">下章');
        expect(html.includes("原书: 一/二")).toBe(status === 200);
        expect(html.includes("章节作者")).toBe(status === 404);
        expect((clickMock.mock.contexts[0] as HTMLAnchorElement).download).toBe(
            status === 200 ? "[原书： 一- 二] 单章测试.html" : "单章测试.html"
        );
        expect(fetchDetail).toHaveBeenCalledExactlyOnceWith(
            "https://www.esjzone.cc/detail/432.html",
            expect.anything()
        );
        expect(addDownloadHistory).toHaveBeenCalledWith(
            expect.objectContaining({ bookId: "432", bookName: status === 200 ? "原书: 一/二" : "单章测试" })
        );
    });

    it("records a failed single-chapter export in diagnostics", async () => {
        createObjectUrlMock.mockImplementationOnce(() => {
            throw new Error("object URL failed");
        });

        const { downloadCurrentPage } = await import("../../src/app/single-download");
        await downloadCurrentPage("txt");
        const { listBrowserDiagnosticSessions } = await import("../../src/diagnostics/runtime");
        const diagnostic = (await listBrowserDiagnosticSessions()).history[0];

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
        await vi.waitFor(() => expect(document.querySelector("#esj-message-diagnostic")).not.toBeNull());
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
        expect((await listBrowserDiagnosticSessions()).history[0]).toMatchObject({
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
        expect((await listBrowserDiagnosticSessions()).history[0]).toMatchObject({
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

    it("rechecks disabled single download buttons when an empty chapter receives its body", async () => {
        document.body.insertAdjacentHTML(
            "beforeend",
            '<div class="entry-navigation"><a class="view-all" href="/detail/1.html">详情</a></div>'
        );
        const body = document.querySelector(".forum-content")!;
        body.innerHTML = "<p><br></p>";
        const { injectSinglePageButton } = await import("../../src/ui/pages/single");
        injectSinglePageButton();
        const txtButton = document.querySelector("#btn-download-single")!;
        const htmlButton = document.querySelector("#btn-download-single-html")!;

        await vi.waitFor(() => expect(txtButton.getAttribute("title")).toContain("內文"));
        expect(txtButton.getAttribute("aria-disabled")).toBe("true");
        expect(htmlButton.getAttribute("aria-disabled")).toBe("true");

        body.querySelector("p")!.textContent = "正文稍后到达";

        await vi.waitFor(() => expect(txtButton.getAttribute("aria-disabled")).toBe("false"));
        expect(htmlButton.getAttribute("aria-disabled")).toBe("false");
    });
});
