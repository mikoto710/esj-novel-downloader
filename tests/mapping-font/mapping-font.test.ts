// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { MAX_CHAPTER_MAPPING_FONT_BYTES, normalizeChapterMappingFont } from "../../src/content/mapping-font";
import { createChapter } from "../support";
import { createMappedContent, createWoff2Bytes } from "../support/mapped-font-fixture";

describe("normalizeChapterMappingFont", () => {
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
        await expect(normalizeChapterMappingFont(result.chapter)).resolves.toEqual({
            kind: "mapped",
            chapter: result.chapter,
            changed: false
        });
    });

    it("accepts a unique data stylesheet inside an otherwise empty direct paragraph", async () => {
        const chapter = createChapter(0, {
            content: createMappedContent({ aroundLink: ["<p>", "</p>"] })
        });

        const result = await normalizeChapterMappingFont(chapter);

        expect(result.kind).toBe("mapped");
        expect(result.chapter.content).not.toContain("data:text/css");
        expect(result.chapter.content).not.toMatch(/^<p>\s*<\/p>/);
        expect(result.chapter.mappingFont).toMatchObject({ family: "1", mediaType: "font/woff2" });
    });

    it.each([
        ['<p class="font-wrapper">', "</p>"],
        ["<p>", "unexpected</p>"],
        ["<div>", "</div>"]
    ])("rejects a stylesheet wrapped in %s…%s", async (before, after) => {
        const chapter = createChapter(0, { content: createMappedContent({ aroundLink: [before, after] }) });

        await expect(normalizeChapterMappingFont(chapter)).rejects.toMatchObject({ code: "structure-invalid" });
    });

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

    it("rejects a WOFF2 with an invalid signature", async () => {
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
});
