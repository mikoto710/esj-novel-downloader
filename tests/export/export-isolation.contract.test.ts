// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCachedData, createChapterFixture, installDocumentFixture } from "../support";

describe("full-book and single-chapter export isolation", () => {
    const alertMock = vi.fn();
    const clickMock = vi.fn();
    const createObjectUrlMock = vi.fn((_blob: Blob) => "blob:single-chapter");

    beforeEach(() => {
        vi.resetModules();
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
});
