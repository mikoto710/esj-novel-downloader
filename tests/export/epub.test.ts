// @vitest-environment jsdom

import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chapter, ChapterImage } from "../../src/content/model";

const { loadScriptMock } = vi.hoisted(() => ({
    loadScriptMock: vi.fn()
}));

vi.mock("../../src/browser/script-loader", () => ({
    loadScript: loadScriptMock
}));

import { buildEpub } from "../../src/export/epub";
import { createMissingChapterPlaceholder } from "../../src/export/snapshot";

import { createBookMetadata, createChapter, createChapterImage } from "../support";

const metadata = createBookMetadata({ title: "测试书籍", tags: [] });

function chapterWithImage(image: ChapterImage): Chapter {
    return createChapter(0, { images: [image], content: `<p>正文<img src="${image.id}" alt="插图"></p>` });
}

describe("buildEpub image resources", () => {
    beforeEach(() => {
        loadScriptMock.mockReset();
        loadScriptMock.mockResolvedValue(JSZip);
    });

    it("writes a normalized image, manifest MIME, and XHTML reference consistently", async () => {
        const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        const image = createChapterImage(0);

        const epub = await buildEpub([chapterWithImage(image)], metadata, false);
        const zip = await JSZip.loadAsync(await epub.arrayBuffer());
        const manifest = await zip.file("OEBPS/content.opf")?.async("string");
        const chapterXhtml = await zip.file("OEBPS/chap_1.xhtml")?.async("string");
        const embeddedImage = await zip.file("OEBPS/img_0_0.jpg")?.async("uint8array");

        expect(manifest).toContain('href="img_0_0.jpg" media-type="image/jpeg"');
        expect(manifest).not.toContain("application/octet-stream");
        expect(chapterXhtml).toContain('src="img_0_0.jpg"');
        expect(embeddedImage).toEqual(bytes);
    });

    it.each([
        ["legacy MIME", "application/octet-stream", new Blob(["image"], { type: "application/octet-stream" })],
        ["mismatched Blob MIME", "image/jpeg", new Blob(["image"], { type: "image/png" })],
        ["empty image", "image/jpeg", new Blob([], { type: "image/jpeg" })]
    ])("keeps chapter text and skips a cached image with %s", async (_reason, mediaType, blob) => {
        const image = { id: "img_0_0.jpg", blob, mediaType } as ChapterImage;

        const epub = await buildEpub([chapterWithImage(image)], metadata, false);
        const zip = await JSZip.loadAsync(await epub.arrayBuffer());
        const manifest = await zip.file("OEBPS/content.opf")?.async("string");
        const chapterXhtml = await zip.file("OEBPS/chap_1.xhtml")?.async("string");

        expect(manifest).not.toContain(image.id);
        expect(zip.file(`OEBPS/${image.id}`)).toBeNull();
        expect(chapterXhtml).not.toContain(image.id);
        expect(chapterXhtml).toContain("正文");
    });

    it("writes static XHTML and one UTC modification timestamp in the package metadata", async () => {
        const chapter: Chapter = {
            title: "章节 <一>",
            txtSegment: "正文",
            content: `<main><details open><summary>章末附录</summary><novel-panel><p>data:text/css</p><ruby>字<rt>音</rt></ruby><table><tr><td>表格</td></tr></table>
                <a href="https://example.test/reading">链接</a><span style="color: red" onclick="">正文</span>
                <script type="text/plain">页面标记</script><object title="页面对象"></object><form><input></form></novel-panel></details></main>`
        };
        vi.setSystemTime(new Date("2026-03-15T13:14:15.678Z"));

        try {
            const sourceUrl = "https://www.esjzone.cc/forum/100/1.html";
            const missingChapter = createMissingChapterPlaceholder({ index: 0, title: "缺失章节", url: sourceUrl });
            const epub = await buildEpub([chapter, missingChapter], { ...metadata, uuid: "id <book> & author" }, false);
            const zip = await JSZip.loadAsync(await epub.arrayBuffer());
            const parser = new DOMParser();
            const opf = parser.parseFromString((await zip.file("OEBPS/content.opf")?.async("string"))!, "text/xml");
            const doc = parser.parseFromString((await zip.file("OEBPS/chap_1.xhtml")?.async("string"))!, "text/xml");

            expect(
                Array.from(opf.querySelectorAll('meta[property="dcterms:modified"]'), (node) => node.textContent)
            ).toEqual(["2026-03-15T13:14:15Z"]);
            expect(opf.getElementById("BookId")?.textContent).toBe("id <book> & author");
            expect(doc.querySelector("title")?.textContent).toBe(chapter.title);
            expect(doc.querySelector("main details[open] summary")?.textContent).toBe("章末附录");
            expect(doc.querySelector("main details p")?.textContent).toBe("data:text/css");
            expect(doc.querySelector("novel-panel")).toBeNull();
            expect(doc.querySelector("ruby rt")?.textContent).toBe("音");
            expect(doc.querySelector("table td")?.textContent).toBe("表格");
            expect(doc.querySelector("a")?.getAttribute("href")).toBe("https://example.test/reading");
            expect(doc.querySelector("span")?.getAttribute("style")).toBe("color: red;");
            expect(doc.querySelector("script, object, form, [onclick]")).toBeNull();

            const missingDoc = parser.parseFromString(
                (await zip.file("OEBPS/chap_2.xhtml")?.async("string"))!,
                "text/xml"
            );
            expect(missingDoc.querySelector(".esj-missing-chapter")?.textContent).toContain("[章节缺失]");
            expect(missingDoc.querySelector(".esj-missing-chapter a")?.getAttribute("href")).toBe(sourceUrl);
        } finally {
            vi.useRealTimers();
        }
    });

    it("embeds a mapped font as an independent manifest resource", async () => {
        const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
        const chapter: Chapter = {
            title: "Mapped chapter",
            content: "<section style=\"font-family: '1', sans-serif;\"><p>Mapped body</p></section>",
            txtSegment: "Mapped chapter\n\nMapped body\n\n",
            mappingFont: {
                family: "1",
                blob: new Blob([fontBytes], { type: "font/woff2" }),
                mediaType: "font/woff2",
                sha256: "a".repeat(64)
            }
        };

        const epub = await buildEpub([chapter], metadata, false);
        const zip = await JSZip.loadAsync(await epub.arrayBuffer());
        const manifest = await zip.file("OEBPS/content.opf")?.async("string");
        const chapterXhtml = await zip.file("OEBPS/chap_1.xhtml")?.async("string");
        const embeddedFont = await zip.file("OEBPS/fonts/font_1_aaaaaaaaaaaa.woff2")?.async("uint8array");

        expect(manifest).toContain('href="fonts/font_1_aaaaaaaaaaaa.woff2" media-type="font/woff2"');
        expect(chapterXhtml).toContain("font-family: 'esj-mapped-1-aaaaaaaaaaaa'");
        expect(chapterXhtml).toContain("url('fonts/font_1_aaaaaaaaaaaa.woff2')");
        expect(chapterXhtml).toContain('lang="en"');
        expect(chapterXhtml).toContain("font-feature-settings: &quot;locl&quot; 0");
        expect(embeddedFont).toEqual(fontBytes);
    });
});
