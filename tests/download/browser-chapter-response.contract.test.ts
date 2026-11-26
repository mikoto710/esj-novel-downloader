// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiagnosticExport } from "../../src/diagnostics/export";
import { clearBrowserDiagnosticSessions, listBrowserDiagnosticSessions } from "../../src/diagnostics/runtime";
import { setChapterRequestMode } from "../../src/storage/settings";
import { formatDiagnosticBookTitle, formatDiagnosticLog } from "../../src/ui/messages/diagnostics";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    expectReadyDownload,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";
import { createChapter } from "../support/factories";
import { createChapterFixture } from "../support/fixtures";
import { deleteTestDatabase } from "../support/resources";

const mocks = getBrowserDownloadMocks();
const loginForm = '<form class="login-box"><input type="email" name="email"><input type="password" name="pwd"></form>';
let runtime: BrowserDownloadRuntime;

describe("browser chapter response contracts", () => {
    beforeEach(async () => {
        vi.stubGlobal("Blob", NodeBlob);
        await clearBrowserDiagnosticSessions();
        runtime = await resetBrowserDownloadHarness();
        const { parseChapterHtml } =
            await vi.importActual<typeof import("../../src/site/chapter")>("../../src/site/chapter");
        mocks.parseChapterHtml.mockImplementation(parseChapterHtml);
    });

    afterEach(async () => {
        await listBrowserDiagnosticSessions();
        await deleteTestDatabase("esj-novel-downloader-diagnostics");
    });

    it("recovers a login response and offers placeholders for chapters still lacking a body", async () => {
        const tasks = createBrowserDownloadTasks(4);
        const normal = "<p>正常正文</p>";
        const recovered = "<p>补抓正文</p>";
        mocks.fetchWithTimeout
            .mockResolvedValueOnce(new Response(loginForm))
            .mockResolvedValueOnce(new Response(loginForm.replace('name="pwd"', 'name="password"')))
            .mockResolvedValueOnce(new Response(createChapterFixture({ contentHtml: "<p> \n <br></p>" })))
            .mockResolvedValueOnce(
                new Response(createChapterFixture({ contentHtml: normal }).replace("</body>", `${loginForm}</body>`))
            )
            .mockResolvedValueOnce(new Response(createChapterFixture({ contentHtml: recovered })))
            .mockImplementation(async () => new Response(""));

        const data = expectReadyDownload(await runtime.runBookDownload(createBrowserDownloadOptions(tasks)));

        expect(mocks.confirmIncompleteChapters).toHaveBeenCalledExactlyOnceWith(
            { missingTasks: [tasks[1], tasks[2]], totalChapters: 4 },
            expect.any(AbortSignal)
        );
        expect(mocks.promptProtectedChapterPassword).not.toHaveBeenCalled();
        expect(data.chapters.map((chapter) => chapter.content)).toEqual([
            recovered,
            expect.stringContaining("[章节缺失]"),
            expect.stringContaining("[章节缺失]"),
            normal
        ]);
        expect(mocks.saveCache.mock.calls.flatMap(([, , batch]) => [...batch])).toEqual([
            [3, expect.objectContaining({ content: normal })],
            [0, expect.objectContaining({ content: recovered })]
        ]);

        const [session] = (await listBrowserDiagnosticSessions()).history;
        const { json } = createDiagnosticExport(session, {
            bookTitle: formatDiagnosticBookTitle(session),
            formatLog: formatDiagnosticLog
        });
        const parseFailure = { scope: "chapter", stage: "parse" };
        expect(JSON.parse(json)).toMatchObject({
            session: {
                task: { processedChapters: 2, persistedChapters: 2, readyChapters: 2, failedChapters: 2 },
                failures: expect.arrayContaining([
                    expect.objectContaining({
                        ...parseFailure,
                        code: "chapter-login-page",
                        chapter: expect.objectContaining({ index: 1 })
                    }),
                    ...[2, 3].map((index) =>
                        expect.objectContaining({
                            ...parseFailure,
                            code: "chapter-content-missing",
                            chapter: expect.objectContaining({ index })
                        })
                    )
                ])
            }
        });
    });

    it.each([false, true])("accepts an image-only chapter with image downloads set to %s", async (imageEnabled) => {
        const { processHtmlImages } =
            await vi.importActual<typeof import("../../src/site/images")>("../../src/site/images");
        mocks.processHtmlImages.mockImplementation(processHtmlImages);
        const imageUrl = "https://example.test/illustration.jpg";
        const chapterHtml = createChapterFixture({ contentHtml: `<img src="${imageUrl}">` });
        mocks.fetchWithTimeout.mockImplementation(async (url: string) =>
            url === imageUrl
                ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { "Content-Type": "image/jpeg" } })
                : new Response(chapterHtml)
        );

        const data = expectReadyDownload(
            await runtime.runBookDownload({
                ...createBrowserDownloadOptions(createBrowserDownloadTasks(1)),
                imageEnabled
            })
        );

        expect(data.exportContext.chapterSummary).toEqual({ totalCount: 1, missingCount: 0 });
        expect(data.chapters[0].content.includes("<img")).toBe(imageEnabled);
        expect(data.chapters[0].images).toHaveLength(imageEnabled ? 1 : 0);
        expect(mocks.confirmIncompleteChapters).not.toHaveBeenCalled();
    });

    it("uses browser fetch for chapter HTML while keeping image requests on GM", async () => {
        const { processHtmlImages } =
            await vi.importActual<typeof import("../../src/site/images")>("../../src/site/images");
        mocks.processHtmlImages.mockImplementation(processHtmlImages);
        const [task] = createBrowserDownloadTasks(1);
        const imageUrl = "https://www.esjzone.cc/forum/100/pictures/a.jpg";
        const externalImageUrl = "https://example.test/pictures/b.jpg";
        expect(new URL("pictures/a.jpg", location.href).href).not.toBe(imageUrl);
        const chapterHtml = createChapterFixture({
            contentHtml: `<p id="notes"><a href="2.html?view=full#end">后记</a>
                <a href="//example.test/notes">译注</a><a href="#notes">本段</a>
                <img src="pictures/a.jpg" alt="插图"><img src="${externalImageUrl}" alt="外链插图"></p>`
        });
        setChapterRequestMode("fetch");
        const browserFetch = vi.fn(async () => new Response(chapterHtml));
        vi.stubGlobal("fetch", browserFetch);
        mocks.fetchWithTimeout.mockImplementation(
            async () =>
                new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { "Content-Type": "image/jpeg" } })
        );

        const data = expectReadyDownload(
            await runtime.runBookDownload({ ...createBrowserDownloadOptions([task]), imageEnabled: true })
        );
        const chapter = data.chapters[0];
        const doc = new DOMParser().parseFromString(chapter.content, "text/html");

        expect(browserFetch).toHaveBeenCalledExactlyOnceWith(
            task.url,
            expect.objectContaining({ credentials: "include", mode: "same-origin" })
        );
        expect(mocks.fetchWithTimeout.mock.calls.map(([url]) => url)).toEqual([imageUrl, externalImageUrl]);
        expect(Array.from(doc.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual([
            "https://www.esjzone.cc/forum/100/2.html?view=full#end",
            "https://example.test/notes",
            "#notes"
        ]);
        expect(Array.from(doc.querySelectorAll("img"), (image) => image.getAttribute("src"))).toEqual([
            "img_0_0.jpg",
            "img_0_1.jpg"
        ]);
        expect(chapter.images).toMatchObject([
            { id: "img_0_0.jpg", mediaType: "image/jpeg" },
            { id: "img_0_1.jpg", mediaType: "image/jpeg" }
        ]);
    });

    it("keeps cached chapter content when an image retry returns a login page", async () => {
        const [task] = createBrowserDownloadTasks(1);
        const cachedChapter = createChapter(task.index, { imageErrors: 1 });
        runtime.task.chapters.set(task.index, cachedChapter);
        mocks.previewCache.mockResolvedValue({
            valid: true,
            size: 1,
            indexes: [task.index],
            compatibility: "compatible"
        });
        mocks.fetchWithTimeout.mockResolvedValueOnce(new Response(loginForm));

        const data = expectReadyDownload(
            await runtime.runBookDownload({ ...createBrowserDownloadOptions([task]), imageEnabled: true })
        );

        expect(mocks.fetchWithTimeout.mock.calls.map(([url]) => url)).toContain(task.url);
        expect(mocks.saveCache).not.toHaveBeenCalled();
        expect(mocks.confirmIncompleteChapters).not.toHaveBeenCalled();
        expect(data.chapters).toEqual([cachedChapter]);
    });
});
