// @vitest-environment jsdom

import { createDownloadHarness } from "../support/download-harness";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCachedData, createChapter, createDeferred } from "../support";

const mocks = vi.hoisted(() => ({
    buildEpub: vi.fn(),
    buildHtml: vi.fn(),
    triggerDownload: vi.fn(),
    addDownloadHistory: vi.fn(async () => undefined),
    log: vi.fn()
}));

vi.mock("../../src/core/export/epub", () => ({ buildEpub: mocks.buildEpub }));
vi.mock("../../src/core/export/html", () => ({ buildHtml: mocks.buildHtml }));
vi.mock("../../src/utils/log", () => ({ log: mocks.log }));
vi.mock("../../src/browser/files", () => ({ triggerDownload: mocks.triggerDownload }));
vi.mock("../../src/storage/history", () => ({ addDownloadHistory: mocks.addDownloadHistory }));

describe("full-book export recovery contracts", () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = "";
        document.title = "ESJZone Test";
        const { setInterfaceLocalePreference } = await import("../../src/storage/settings");
        setInterfaceLocalePreference("zh-CN");
        mocks.buildEpub.mockResolvedValue(new Blob(["epub"], { type: "application/epub+zip" }));
        mocks.buildHtml.mockResolvedValue(new Blob(["html"], { type: "text/html" }));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("retries EPUB generation without caching a failed result", async () => {
        const epubBlob = new Blob(["valid epub"], { type: "application/epub+zip" });
        mocks.buildEpub.mockRejectedValueOnce(new Error("zip generation failed")).mockResolvedValueOnce(epubBlob);
        const { state } = await prepareExportPopup();

        click("#esj-epub");
        await waitForMessage();

        expect(state.cachedData?.epubBlob).toBeNull();
        expect((document.querySelector("#esj-epub") as HTMLButtonElement).disabled).toBe(false);
        expect(document.title).toBe("ESJZone Test");
        closeMessage();

        click("#esj-epub");
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledOnce());

        expect(mocks.buildEpub).toHaveBeenCalledTimes(2);
        expect(state.cachedData?.epubBlob).toBe(epubBlob);
        expect(mocks.addDownloadHistory).toHaveBeenCalledWith(
            expect.objectContaining({
                format: "epub",
                chapterSummary: { totalCount: 1, missingCount: 0 }
            })
        );
    });

    it("reuses a valid EPUB blob when the browser download trigger fails", async () => {
        const epubBlob = new Blob(["valid epub"], { type: "application/epub+zip" });
        mocks.buildEpub.mockResolvedValue(epubBlob);
        mocks.triggerDownload.mockImplementationOnce(() => {
            throw new Error("object URL unavailable");
        });
        const { state } = await prepareExportPopup();
        const diagnostics = await import("../../src/adapters/browser-diagnostics");
        diagnostics.startBrowserDiagnosticSession({
            taskId: "export-retry",
            bookId: "100",
            bookTitle: "Export retry",
            pageUrl: "https://www.esjzone.cc/detail/100.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        diagnostics.finishBrowserDiagnosticSession("export-retry", "success");

        click("#esj-epub");
        await waitForMessage();

        expect(state.cachedData?.epubBlob).toBe(epubBlob);
        expect(mocks.addDownloadHistory).not.toHaveBeenCalled();
        closeMessage();

        click("#esj-epub");
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledTimes(2));

        expect(mocks.buildEpub).toHaveBeenCalledOnce();
        expect(mocks.addDownloadHistory).toHaveBeenCalledOnce();
        expect(diagnostics.listBrowserDiagnosticSessions().history[0].exports).toEqual([
            expect.objectContaining({
                format: "epub",
                outcome: "failed",
                generated: true,
                downloadTriggered: false,
                failureStage: "download"
            }),
            expect.objectContaining({
                format: "epub",
                outcome: "success",
                generated: true,
                downloadTriggered: true
            })
        ]);
    });

    it("does not restore an EPUB cache invalidated while generation is pending", async () => {
        const { setEpubTagPageSetting } = await import("../../src/storage/settings");
        const { invalidateCachedEpub } = await import("../../src/core/state");
        setEpubTagPageSetting(false);
        const pending = createDeferred<Blob>();
        mocks.buildEpub.mockReturnValueOnce(pending.promise);
        const { state } = await prepareExportPopup();
        click("#esj-epub");
        await vi.waitFor(() => expect(mocks.buildEpub).toHaveBeenCalledOnce());
        setEpubTagPageSetting(true);
        invalidateCachedEpub();
        pending.resolve(new Blob(["old settings"]));
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledOnce());
        expect(state.cachedData?.epubBlob).toBeNull();
        click("#esj-epub");
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledTimes(2));
        expect(mocks.buildEpub).toHaveBeenLastCalledWith(state.cachedData?.chapters, state.cachedData?.metadata, true);
    });

    it("rebuilds EPUB when another page changes the tag setting", async () => {
        const { setEpubTagPageSetting } = await import("../../src/storage/settings");
        setEpubTagPageSetting(false);
        const { state } = await prepareExportPopup();
        click("#esj-epub");
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledOnce());
        setEpubTagPageSetting(true);
        click("#esj-epub");
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledTimes(2));
        expect(mocks.buildEpub).toHaveBeenCalledTimes(2);
        expect(mocks.buildEpub).toHaveBeenLastCalledWith(state.cachedData?.chapters, state.cachedData?.metadata, true);
    });

    it("records a retained export against its source task after another task fails", async () => {
        const diagnostics = await import("../../src/adapters/browser-diagnostics");
        const input = {
            bookId: "100",
            bookTitle: "Book",
            pageUrl: "https://example.test/book",
            sourcePageType: "detail" as const,
            imageEnabled: false
        };
        diagnostics.startBrowserDiagnosticSession({ ...input, taskId: "original-export" });
        diagnostics.finishBrowserDiagnosticSession("original-export", "success");
        const data = createCachedData();
        await prepareExportPopup({ ...data, exportContext: { ...data.exportContext!, taskId: "original-export" } });
        diagnostics.startBrowserDiagnosticSession({ ...input, taskId: "later-failure" });
        diagnostics.finishBrowserDiagnosticSession("later-failure", "failed");
        click("#esj-txt");
        const sessions = diagnostics.listBrowserDiagnosticSessions().history;
        expect(sessions.find((session) => session.taskId === "original-export")?.exports).toEqual([
            expect.objectContaining({ outcome: "success", format: "txt" })
        ]);
        expect(sessions.find((session) => session.taskId === "later-failure")?.exports).toEqual([]);
    });

    it("keeps the new task title when a closed format popup finishes EPUB generation", async () => {
        const pending = createDeferred<Blob>();
        mocks.buildEpub.mockReturnValueOnce(pending.promise);
        await prepareExportPopup();
        click("#esj-epub");
        await vi.waitFor(() => expect(mocks.buildEpub).toHaveBeenCalledOnce());
        click("#esj-format .esj-common-header button");
        const { activateDownload } = await import("../../src/core/state");
        activateDownload("200", "new-task", createDownloadHarness([]).dependencies.cancellation);
        document.title = "[1/3] new task";
        pending.resolve(new Blob(["epub"]));
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledOnce());
        expect(document.title).toBe("[1/3] new task");
    });

    it("keeps HTML retryable after consecutive generation failures", async () => {
        mocks.buildHtml.mockRejectedValue(new Error("缺少已校验的映射字体"));
        await prepareExportPopup();

        click("#esj-html");
        await waitForMessage();
        expect(document.querySelector("#esj-message-details")?.textContent).toContain("缺少已校验的映射字体");
        expect((document.querySelector("#esj-html") as HTMLButtonElement).disabled).toBe(false);
        closeMessage();

        click("#esj-txt");
        expect(mocks.triggerDownload).toHaveBeenCalledOnce();
        expect(mocks.addDownloadHistory).toHaveBeenCalledWith(expect.objectContaining({ format: "txt" }));

        click("#esj-html");
        await vi.waitFor(() => expect(mocks.buildHtml).toHaveBeenCalledTimes(2));
        await waitForMessage();
        expect(mocks.triggerDownload).toHaveBeenCalledOnce();
        closeMessage();

        mocks.buildHtml.mockResolvedValueOnce(new Blob(["recovered html"], { type: "text/html" }));
        click("#esj-html");
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledTimes(2));
        expect(mocks.addDownloadHistory).toHaveBeenCalledWith(expect.objectContaining({ format: "html" }));
    });

    it("prevents duplicate HTML builds while allowing another format to export", async () => {
        const htmlBuild = createDeferred<Blob>();
        mocks.buildHtml.mockReturnValue(htmlBuild.promise);
        await prepareExportPopup();

        click("#esj-html");
        click("#esj-html");
        click("#esj-txt");

        expect(mocks.buildHtml).toHaveBeenCalledOnce();
        expect(mocks.triggerDownload).toHaveBeenCalledOnce();
        expect(mocks.addDownloadHistory).toHaveBeenCalledWith(expect.objectContaining({ format: "txt" }));

        htmlBuild.resolve(new Blob(["html"], { type: "text/html" }));
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledTimes(2));
        expect(mocks.addDownloadHistory).toHaveBeenCalledWith(expect.objectContaining({ format: "html" }));
    });

    it("uses the captured range snapshot for filenames and history", async () => {
        const rangeData = createCachedData({
            exportContext: {
                bookId: "100",
                rawBookName: "测试小说",
                pageUrl: "https://www.esjzone.cc/detail/100.html",
                sourcePageType: "detail",
                chapterSummary: { totalCount: 20, missingCount: 1 },
                selection: {
                    mode: "range",
                    sourceTotalChapters: 120,
                    startChapter: 101,
                    endChapter: 120
                },
                imageEnabled: false
            }
        });
        const { state } = await prepareExportPopup(rangeData);

        state.cachedData = createCachedData();
        click("#esj-txt");

        expect(mocks.triggerDownload).toHaveBeenCalledWith(expect.any(Blob), "测试小说_第101-120章.txt");
        await vi.waitFor(() =>
            expect(mocks.addDownloadHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    chapterSummary: { totalCount: 20, missingCount: 1 },
                    selection: {
                        mode: "range",
                        sourceTotalChapters: 120,
                        startChapter: 101,
                        endChapter: 120
                    }
                })
            )
        );
    });

    it("reports TXT download failures with bounded details and succeeds after closing the message", async () => {
        const longMessage = `object URL failed: ${"x".repeat(2_500)}`;
        mocks.triggerDownload.mockImplementationOnce(() => {
            throw new Error(longMessage);
        });
        await prepareExportPopup();

        click("#esj-txt");
        await waitForMessage();

        const details = document.querySelector("#esj-message-details")?.textContent || "";
        expect(details.length).toBeLessThan(longMessage.length);
        expect(mocks.addDownloadHistory).not.toHaveBeenCalled();
        closeMessage();

        click("#esj-txt");
        expect(mocks.triggerDownload).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => expect(mocks.addDownloadHistory).toHaveBeenCalledOnce());
    });

    it("restores TXT export after Blob construction fails", async () => {
        const NativeBlob = globalThis.Blob;
        await prepareExportPopup();
        class ThrowingBlob {
            constructor() {
                throw new Error("blob allocation failed");
            }
        }
        vi.stubGlobal("Blob", ThrowingBlob);

        click("#esj-txt");
        await waitForMessage();
        expect(document.querySelector("#esj-message-details")?.textContent).toContain("blob allocation failed");
        expect(mocks.triggerDownload).not.toHaveBeenCalled();
        closeMessage();

        vi.stubGlobal("Blob", NativeBlob);
        click("#esj-txt");
        expect(mocks.triggerDownload).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(mocks.addDownloadHistory).toHaveBeenCalledOnce());
    });

    it("restores mapped EPUB controls after confirmation is cancelled", async () => {
        const mappedChapter = createChapter(0, {
            mappingFont: {
                family: "1",
                blob: new Blob([new Uint8Array(64)], { type: "font/woff2" }),
                mediaType: "font/woff2",
                sha256: "a".repeat(64)
            }
        });
        await prepareExportPopup(createCachedData({ chapters: [mappedChapter] }));
        const diagnostics = await import("../../src/adapters/browser-diagnostics");
        diagnostics.startBrowserDiagnosticSession({
            taskId: "mapped-cancel",
            bookId: "101",
            bookTitle: "Mapped cancel",
            pageUrl: "https://www.esjzone.cc/detail/101.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        diagnostics.finishBrowserDiagnosticSession("mapped-cancel", "success");

        click("#esj-epub");
        await vi.waitFor(() => expect(document.querySelector("#esj-mapping-export-confirm")).not.toBeNull());
        click("#esj-mapping-export-confirm .esj-common-header button");
        await vi.waitFor(() => expect((document.querySelector("#esj-epub") as HTMLButtonElement).disabled).toBe(false));
        expect(mocks.buildEpub).not.toHaveBeenCalled();
        expect(diagnostics.listBrowserDiagnosticSessions().history[0].exports).toEqual([
            expect.objectContaining({ format: "epub", outcome: "cancelled", generated: false })
        ]);

        click("#esj-epub");
        await vi.waitFor(() => expect(document.querySelector("#esj-mapping-export-continue")).not.toBeNull());
        click("#esj-mapping-export-continue");
        await vi.waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledOnce());
        expect(mocks.buildEpub).toHaveBeenCalledOnce();
    });
});

async function prepareExportPopup(data = createCachedData()) {
    const [{ state }, { showFormatChoice }] = await Promise.all([
        import("../../src/core/state"),
        import("../../src/ui/popups")
    ]);
    state.cachedData = data;
    state.originalTitle = document.title;
    showFormatChoice(data);
    return { state, showFormatChoice };
}

function click(selector: string): void {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (!element) {
        throw new Error(`missing test element: ${selector}`);
    }
    element.click();
}

async function waitForMessage(): Promise<void> {
    await vi.waitFor(() => {
        expect(document.querySelector("#esj-message-popup")).not.toBeNull();
    });
}

function closeMessage(): void {
    click("#esj-message-close");
}
