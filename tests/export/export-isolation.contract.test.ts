// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createCachedData,
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
        vi.doUnmock("../../src/adapters/browser-protected-chapter");
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

    it("does not replace full-book export data when exporting a single chapter", async () => {
        const { state } = await import("../../src/core/state");
        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        const fullBookData = createCachedData();
        state.cachedData = fullBookData;

        await downloadCurrentPage("txt");

        const { listBrowserDiagnosticSessions } = await import("../../src/adapters/browser-diagnostics");
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
        vi.doMock("../../src/utils/image", () => ({
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

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        await downloadCurrentPage("html");

        const { listBrowserDiagnosticSessions } = await import("../../src/adapters/browser-diagnostics");
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

    it("preserves the source shaping environment in mapped single-chapter HTML", async () => {
        const bytes = new Uint8Array(64);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, 0x774f4632, false);
        view.setUint32(8, bytes.byteLength, false);
        const fontDataUrl = `data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}`;
        const css = `@font-face { font-family: '1'; src: url('${fontDataUrl}') format('woff2'); font-display: swap; }`;
        const contentHtml = `<link rel="stylesheet" href="data:text/css,${encodeURIComponent(css)}"><section style="font-family: '1', sans-serif;"><p>Mapped body</p></section>`;
        const fixture = new DOMParser().parseFromString(
            createChapterFixture({ title: "Mapped chapter", contentHtml }),
            "text/html"
        );
        installDocumentFixture(fixture);

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        const exportPromise = downloadCurrentPage("html");

        await vi.waitFor(() => {
            expect(document.querySelector("#esj-mapping-export-continue")).not.toBeNull();
        });
        (document.querySelector("#esj-mapping-export-continue") as HTMLButtonElement).click();
        await exportPromise;

        const exportedBlob = createObjectUrlMock.mock.calls[0]?.[0] as Blob;
        const exportedHtml = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(exportedBlob);
        });
        expect(exportedHtml).toContain("font-display: swap");
        expect(exportedHtml).toContain('lang="en"');
        expect(exportedHtml).toContain("font-feature-settings: &quot;locl&quot; 0");
    });

    it("records a failed single-chapter export in diagnostics", async () => {
        createObjectUrlMock.mockImplementationOnce(() => {
            throw new Error("object URL failed");
        });

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        await downloadCurrentPage("txt");
        const { listBrowserDiagnosticSessions } = await import("../../src/adapters/browser-diagnostics");
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

    it("unlocks a protected single chapter before TXT parsing and export", async () => {
        installProtectedSinglePage();
        const unlock = vi.fn().mockResolvedValue({
            kind: "unlocked",
            html: createChapterFixture({ title: "Unlocked chapter", contentHtml: "<p>Unlocked body</p>" })
        });
        mockProtectedAuth(unlock);

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        const exportPromise = downloadCurrentPage("txt");
        await submitProtectedPassword("fictional-password");
        await exportPromise;

        expect(unlock).toHaveBeenCalledWith(
            expect.objectContaining({ index: 0, title: "Protected chapter" }),
            expect.stringContaining('id="oops"'),
            "fictional-password",
            expect.any(AbortSignal)
        );
        const exportedBlob = createObjectUrlMock.mock.calls.at(-1)?.[0] as Blob;
        const exportedText = await exportedBlob.text();
        expect(exportedText).toContain("Unlocked body");
        expect(exportedText).not.toContain("fictional-password");
        expect(document.querySelector("#esj-protected-chapter")).toBeNull();

        const { listBrowserDiagnosticSessions } = await import("../../src/adapters/browser-diagnostics");
        const diagnostic = listBrowserDiagnosticSessions().history[0];
        expect(diagnostic).toMatchObject({ result: "success", book: { sourcePageType: "single" } });
        expect(JSON.stringify(diagnostic)).not.toContain("fictional-password");
    });

    it("gets a fresh authorization result after a rejected single-chapter password", async () => {
        installProtectedSinglePage();
        const unlock = vi
            .fn()
            .mockResolvedValueOnce({ kind: "password-rejected", message: "密码不正确" })
            .mockResolvedValueOnce({
                kind: "unlocked",
                html: createChapterFixture({ title: "Unlocked chapter", contentHtml: "<p>Unlocked body</p>" })
            });
        mockProtectedAuth(unlock);

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        const exportPromise = downloadCurrentPage("txt");
        await submitProtectedPassword("wrong-password", true);
        await vi.waitFor(() => {
            expect(document.querySelector("#esj-protected-error")?.textContent).toBe("密码不正确");
        });
        expect((document.querySelector("#esj-protected-password") as HTMLInputElement).value).toBe("");
        await submitProtectedPassword("correct-password");
        await exportPromise;

        expect(unlock).toHaveBeenCalledTimes(2);
        expect(unlock.mock.calls[0][2]).toBe("wrong-password");
        expect(unlock.mock.calls[1][2]).toBe("correct-password");
        expect(clickMock).toHaveBeenCalledOnce();
    });

    it("automatically retries one technical single-chapter authorization failure", async () => {
        installProtectedSinglePage();
        const unlock = vi
            .fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({
                kind: "unlocked",
                html: createChapterFixture({ title: "Unlocked chapter", contentHtml: "<p>Unlocked body</p>" })
            });
        mockProtectedAuth(unlock);

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        const exportPromise = downloadCurrentPage("txt");
        await submitProtectedPassword("fictional-password");
        await exportPromise;

        expect(unlock).toHaveBeenCalledTimes(2);
        expect(document.querySelector("#esj-protected-chapter")).toBeNull();
        expect(clickMock).toHaveBeenCalledOnce();
        const { listBrowserDiagnosticSessions } = await import("../../src/adapters/browser-diagnostics");
        expect(JSON.stringify(listBrowserDiagnosticSessions().history[0])).not.toContain("fictional-password");
    });

    it("continues mapped-font HTML handling after unlocking a protected single chapter", async () => {
        installProtectedSinglePage();
        const bytes = new Uint8Array(64);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, 0x774f4632, false);
        view.setUint32(8, bytes.byteLength, false);
        const fontDataUrl = `data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}`;
        const css = `@font-face { font-family: '1'; src: url('${fontDataUrl}') format('woff2'); font-display: swap; }`;
        const contentHtml = `<link rel="stylesheet" href="data:text/css,${encodeURIComponent(css)}"><section style="font-family: '1', sans-serif;"><p>Mapped unlocked body</p></section>`;
        const unlock = vi.fn().mockResolvedValue({
            kind: "unlocked",
            html: createChapterFixture({ title: "Mapped unlocked", contentHtml })
        });
        mockProtectedAuth(unlock);

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        const exportPromise = downloadCurrentPage("html");
        await submitProtectedPassword("fictional-password");
        await vi.waitFor(() => expect(document.querySelector("#esj-mapping-export-continue")).not.toBeNull());
        (document.querySelector("#esj-mapping-export-continue") as HTMLButtonElement).click();
        await exportPromise;

        const exportedBlob = createObjectUrlMock.mock.calls.at(-1)?.[0] as Blob;
        const exportedHtml = await exportedBlob.text();
        expect(exportedHtml).toContain("Mapped unlocked body");
        expect(exportedHtml).toContain("font-display: swap");
    });

    it("cancels an in-flight protected single-chapter request without exporting", async () => {
        installProtectedSinglePage();
        const unlock = vi.fn(
            (_task, _html, _password, signal?: AbortSignal) =>
                new Promise((_resolve, reject) => {
                    signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), {
                        once: true
                    });
                })
        );
        mockProtectedAuth(unlock);

        const { downloadCurrentPage } = await import("../../src/scrapers/single");
        const exportPromise = downloadCurrentPage("txt");
        await submitProtectedPassword("fictional-password");
        await vi.waitFor(() => expect(unlock).toHaveBeenCalledOnce());
        expect((document.querySelector("#esj-protected-submit") as HTMLButtonElement).disabled).toBe(true);
        (document.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await exportPromise;

        expect((unlock.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
        expect(clickMock).not.toHaveBeenCalled();
        const { listBrowserDiagnosticSessions } = await import("../../src/adapters/browser-diagnostics");
        expect(listBrowserDiagnosticSessions().history[0]).toMatchObject({ result: "cancelled" });
    });
});

function installProtectedSinglePage(): void {
    const fixture = new DOMParser().parseFromString(
        createProtectedChapterFixture({ title: "Protected chapter" }),
        "text/html"
    );
    installDocumentFixture(fixture);
    document.title = "Protected chapter - ESJZone";
}

function mockProtectedAuth(unlock: ReturnType<typeof vi.fn>): void {
    vi.doMock("../../src/adapters/browser-protected-chapter", async () => {
        const actual = await vi.importActual<typeof import("../../src/adapters/browser-protected-chapter")>(
            "../../src/adapters/browser-protected-chapter"
        );
        return { ...actual, createBrowserProtectedChapterAuth: () => ({ unlock }) };
    });
}

async function submitProtectedPassword(password: string, rememberPassword = false): Promise<void> {
    await vi.waitFor(() => expect(document.querySelector("#esj-protected-password")).not.toBeNull());
    const input = document.querySelector("#esj-protected-password") as HTMLInputElement;
    const remember = document.querySelector("#esj-protected-remember") as HTMLInputElement;
    input.value = password;
    remember.checked = rememberPassword;
    (document.querySelector("#esj-protected-submit") as HTMLButtonElement).click();
}
