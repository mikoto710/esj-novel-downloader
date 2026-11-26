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
        ["application/octet-stream", new Blob(["image"], { type: "application/octet-stream" }), "不支持的 MIME"],
        ["image/jpeg", new Blob(["image"], { type: "image/png" }), "不一致"],
        ["image/jpeg", new Blob([], { type: "image/jpeg" }), "内容为空"]
    ])("rejects an invalid EPUB image (%s, %s)", async (mediaType, blob, reason) => {
        const image = { id: "img_0_0.jpg", blob, mediaType } as ChapterImage;

        await expect(buildEpub([chapterWithImage(image)], metadata, false)).rejects.toThrow(reason);
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

    it("keeps the explicit missing chapter warning and source URL", async () => {
        const chapter = createMissingChapterPlaceholder({
            index: 0,
            title: "缺失章节",
            url: "https://www.esjzone.cc/forum/100/1.html"
        });

        const epub = await buildEpub([chapter], metadata, false);
        const zip = await JSZip.loadAsync(await epub.arrayBuffer());
        const chapterXhtml = await zip.file("OEBPS/chap_1.xhtml")?.async("string");

        expect(chapterXhtml).toContain("[章节缺失]");
        expect(chapterXhtml).toContain("https://www.esjzone.cc/forum/100/1.html");
    });
});
