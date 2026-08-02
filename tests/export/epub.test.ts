// @vitest-environment jsdom

import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMetadata, Chapter, ChapterImage } from "../../src/types";

const { loadScriptMock, logMock } = vi.hoisted(() => ({
    loadScriptMock: vi.fn(),
    logMock: vi.fn()
}));

vi.mock("../../src/utils/index", () => ({
    loadScript: loadScriptMock,
    log: logMock
}));

import { buildEpub } from "../../src/core/epub";

const metadata: BookMetadata = {
    title: "测试书籍",
    author: "测试作者",
    description: "测试简介",
    tags: [],
    coverBlob: null,
    coverExt: "jpg"
};

function createChapter(image: ChapterImage): Chapter {
    return {
        title: "测试章节",
        content: `<p>正文<img src="${image.id}" alt="插图"></p>`,
        txtSegment: "测试章节\n\n正文\n\n",
        images: [image],
        imageErrors: 0
    };
}

describe("buildEpub image resources", () => {
    beforeEach(() => {
        loadScriptMock.mockReset();
        loadScriptMock.mockResolvedValue(JSZip);
        logMock.mockReset();
    });

    it("writes a normalized image, manifest MIME, and XHTML reference consistently", async () => {
        const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        const image: ChapterImage = {
            id: "img_0_0.jpg",
            blob: new Blob([bytes], { type: "image/jpeg" }),
            mediaType: "image/jpeg"
        };

        const epub = await buildEpub([createChapter(image)], metadata, false);
        const zip = await JSZip.loadAsync(await epub.arrayBuffer());
        const manifest = await zip.file("OEBPS/content.opf")?.async("string");
        const chapterXhtml = await zip.file("OEBPS/chap_1.xhtml")?.async("string");
        const embeddedImage = await zip.file("OEBPS/img_0_0.jpg")?.async("uint8array");

        expect(manifest).toContain('href="img_0_0.jpg" media-type="image/jpeg"');
        expect(manifest).not.toContain("application/octet-stream");
        expect(chapterXhtml).toContain('src="img_0_0.jpg"');
        expect(embeddedImage).toEqual(bytes);
    });

    it("rejects a legacy generic-binary manifest MIME", async () => {
        const invalidImage = {
            id: "img_0_0.jpg",
            blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "application/octet-stream" }),
            mediaType: "application/octet-stream"
        } as unknown as ChapterImage;

        await expect(buildEpub([createChapter(invalidImage)], metadata, false)).rejects.toThrow(
            "EPUB 不支持的 MIME: application/octet-stream"
        );
    });

    it("rejects a Blob whose MIME disagrees with the manifest", async () => {
        const mismatchedImage: ChapterImage = {
            id: "img_0_0.jpg",
            blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "application/octet-stream" }),
            mediaType: "image/jpeg"
        };

        await expect(buildEpub([createChapter(mismatchedImage)], metadata, false)).rejects.toThrow(
            "Blob MIME (application/octet-stream) 与 manifest MIME (image/jpeg) 不一致"
        );
    });

    it("rejects an empty image Blob", async () => {
        const emptyImage: ChapterImage = {
            id: "img_0_0.jpg",
            blob: new Blob([], { type: "image/jpeg" }),
            mediaType: "image/jpeg"
        };

        await expect(buildEpub([createChapter(emptyImage)], metadata, false)).rejects.toThrow(
            "图片 img_0_0.jpg 内容为空"
        );
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
        expect(chapterXhtml).toContain("font-display: swap");
        expect(chapterXhtml).toContain('lang="en"');
        expect(chapterXhtml).toContain("font-feature-settings: &quot;locl&quot; 0");
        expect(embeddedFont).toEqual(fontBytes);
    });
});
