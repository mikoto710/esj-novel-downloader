// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildHtml } from "../../src/core/export/html";
import { createMissingChapterPlaceholder } from "../../src/core/download/incomplete-chapters";
import { createBookMetadata, createChapter } from "../support";

function createMappedChapter() {
    return createChapter(0, {
        content: "<section style=\"font-family: '1', sans-serif;\"><p>Mapped body</p></section>",
        mappingFont: {
            family: "1",
            blob: new Blob([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], { type: "font/woff2" }),
            mediaType: "font/woff2",
            sha256: "a".repeat(64)
        }
    });
}

async function readBlob(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

describe("buildHtml mapped font resources", () => {
    it("creates a collapsed semantic chapter navigation with anchors", async () => {
        const chapters = [createChapter(0, { title: "第一章" }), createChapter(1, { title: "第二章" })];
        const html = await readBlob(await buildHtml(chapters, createBookMetadata()));

        expect(html).toContain('<nav class="toc" aria-label="章节导航">');
        expect(html).toContain('<details><summary>章节导航（2）</summary><ol class="toc-list">');
        expect(html).not.toContain("<details open>");
        expect(html).toContain('<a href="#chap0">第一章</a>');
        expect(html).toContain('<a href="#chap1">第二章</a>');
        expect(html).toContain('id="chap0" class="chapter"');
        expect(html).toContain('id="chap1" class="chapter"');
    });

    it("embeds a controlled WOFF2 data URL and rewrites the chapter family", async () => {
        const blob = await buildHtml([createMappedChapter()], createBookMetadata());
        const html = await readBlob(blob);

        expect(html).toContain("@font-face { font-family: 'esj-mapped-1-aaaaaaaaaaaa'");
        expect(html).toContain("data:font/woff2;base64,d09GMg==");
        expect(html).toContain("font-display: swap");
        expect(html).toContain("font-family: &quot;esj-mapped-1-aaaaaaaaaaaa&quot;, sans-serif");
        expect(html).toContain('lang="en"');
        expect(html).toContain("font-feature-settings: &quot;locl&quot; 0");
        expect(html).not.toContain("data:text/css");
    });

    it("rejects mapping signals when the validated font is missing", async () => {
        const chapter = createChapter(0, {
            content: "<section style=\"font-family: '1', sans-serif;\"><p>Mapped body</p></section>"
        });

        await expect(buildHtml([chapter], createBookMetadata())).rejects.toMatchObject({
            code: "structure-invalid",
            reason: "export-font-missing"
        });
    });

    it("keeps the explicit missing chapter warning and source URL", async () => {
        const chapter = createMissingChapterPlaceholder({
            index: 0,
            title: "缺失章节",
            url: "https://www.esjzone.cc/forum/100/1.html"
        });

        const html = await readBlob(await buildHtml([chapter], createBookMetadata()));

        expect(html).toContain("[章节缺失]");
        expect(html).toContain("https://www.esjzone.cc/forum/100/1.html");
        expect(html).toContain('class="esj-missing-chapter"');
    });
});
