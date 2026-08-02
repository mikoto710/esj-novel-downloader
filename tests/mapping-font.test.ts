// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { MAX_CHAPTER_MAPPING_FONT_BYTES, normalizeChapterMappingFont } from "../src/core/mapping-font";
import { createChapter } from "./support";

function createWoff2Bytes(size = 64): Uint8Array {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x774f4632, false);
    view.setUint32(8, size, false);
    return bytes;
}

function createMappedContent(
    options: {
        family?: string;
        sectionFamily?: string;
        bytes?: Uint8Array;
        linkContainer?: "direct" | "empty-paragraph" | "attributed-paragraph" | "paragraph-with-text" | "div";
    } = {}
): string {
    const family = options.family || "1";
    const sectionFamily = options.sectionFamily || family;
    const bytes = options.bytes || createWoff2Bytes();
    const fontDataUrl = `data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}`;
    const css = `@font-face { font-family: '${family}'; src: url('${fontDataUrl}') format('woff2'); }`;
    const cssDataUrl = `data:text/css,${encodeURIComponent(css)}`;
    const link = `<link rel="stylesheet" href="${cssDataUrl}">`;
    const linkHtml =
        options.linkContainer === "empty-paragraph"
            ? `<p>${link}</p>`
            : options.linkContainer === "attributed-paragraph"
              ? `<p class="font-wrapper">${link}</p>`
              : options.linkContainer === "paragraph-with-text"
                ? `<p>${link}unexpected</p>`
                : options.linkContainer === "div"
                  ? `<div>${link}</div>`
                  : link;
    return `${linkHtml}<section style="font-family: '${sectionFamily}', sans-serif;"><p>合成正文</p></section>`;
}

describe("normalizeChapterMappingFont", () => {
    it("keeps a normal chapter unchanged", async () => {
        const chapter = createChapter();

        const result = await normalizeChapterMappingFont(chapter);

        expect(result).toEqual({ kind: "normal", chapter, changed: false });
    });

    it("extracts a strictly matched font and removes the page data CSS", async () => {
        const chapter = createChapter(0, { content: createMappedContent() });

        const result = await normalizeChapterMappingFont(chapter);

        expect(result.kind).toBe("mapped");
        expect(result.changed).toBe(true);
        expect(result.chapter.content).not.toContain("data:text/css");
        expect(result.chapter.content).toContain("font-family: '1', sans-serif");
        expect(result.chapter.mappingFont).toMatchObject({ family: "1", mediaType: "font/woff2" });
        expect(result.chapter.mappingFont?.blob.size).toBe(64);
        expect(result.chapter.mappingFont?.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("accepts a unique data stylesheet inside an otherwise empty direct paragraph", async () => {
        const chapter = createChapter(0, {
            content: createMappedContent({ linkContainer: "empty-paragraph" })
        });

        const result = await normalizeChapterMappingFont(chapter);

        expect(result.kind).toBe("mapped");
        expect(result.chapter.content).not.toContain("data:text/css");
        expect(result.chapter.content).not.toMatch(/^<p>\s*<\/p>/);
        expect(result.chapter.mappingFont).toMatchObject({ family: "1", mediaType: "font/woff2" });
    });

    it.each(["attributed-paragraph", "paragraph-with-text", "div"] as const)(
        "rejects a data stylesheet in an unsafe %s wrapper",
        async (linkContainer) => {
            const chapter = createChapter(0, { content: createMappedContent({ linkContainer }) });

            await expect(normalizeChapterMappingFont(chapter)).rejects.toMatchObject({
                code: "structure-invalid"
            });
        }
    );

    it("does not classify a normal non-numeric font style as mapped", async () => {
        const chapter = createChapter(0, {
            content: '<section style="font-family: serif;"><p>普通正文</p></section>'
        });

        const result = await normalizeChapterMappingFont(chapter);

        expect(result.kind).toBe("normal");
    });

    it("rejects partial mapping signals instead of treating them as normal", async () => {
        const chapter = createChapter(0, {
            content: "<section style=\"font-family: '1', sans-serif;\"><p>合成正文</p></section>"
        });

        await expect(normalizeChapterMappingFont(chapter)).rejects.toMatchObject({
            name: "MappingFontError",
            code: "structure-invalid"
        });
    });

    it("rejects a stylesheet whose family does not match the content", async () => {
        const chapter = createChapter(0, { content: createMappedContent({ family: "1", sectionFamily: "2" }) });

        await expect(normalizeChapterMappingFont(chapter)).rejects.toMatchObject({
            code: "css-invalid"
        });
    });

    it("rejects a WOFF2 with an invalid signature or declared length", async () => {
        const bytes = createWoff2Bytes();
        bytes[0] = 0;
        const chapter = createChapter(0, { content: createMappedContent({ bytes }) });

        await expect(normalizeChapterMappingFont(chapter)).rejects.toMatchObject({
            code: "woff2-invalid"
        });
    });

    it("rejects a mapped font above the safety limit", async () => {
        const chapter = createChapter(0, {
            content: createMappedContent({ bytes: createWoff2Bytes(MAX_CHAPTER_MAPPING_FONT_BYTES + 1) })
        });

        await expect(normalizeChapterMappingFont(chapter)).rejects.toMatchObject({
            code: "font-too-large"
        });
    });

    it("stops normalization when cancellation is requested", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            normalizeChapterMappingFont(createChapter(0, { content: createMappedContent() }), controller.signal)
        ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("validates an already normalized chapter idempotently", async () => {
        const first = await normalizeChapterMappingFont(createChapter(0, { content: createMappedContent() }));

        const second = await normalizeChapterMappingFont(first.chapter);

        expect(second).toEqual({ kind: "mapped", chapter: first.chapter, changed: false });
    });
});
