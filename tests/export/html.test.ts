// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildBookHtml, buildCurrentChapterHtml } from "../../src/export/html";
import { createMissingChapterPlaceholder } from "../../src/export/snapshot";
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

describe("buildBookHtml mapped font resources", () => {
    it("embeds a controlled WOFF2 data URL and rewrites the chapter family", async () => {
        const blob = await buildBookHtml([createMappedChapter()], createBookMetadata());
        const html = await blob.text();

        expect(html).toContain("@font-face { font-family: 'esj-mapped-1-aaaaaaaaaaaa'");
        expect(html).toContain("data:font/woff2;base64,d09GMg==");
        expect(html).toContain("font-family: &quot;esj-mapped-1-aaaaaaaaaaaa&quot;, sans-serif");
        expect(html).toContain('lang="en"');
        expect(html).toContain("font-feature-settings: &quot;locl&quot; 0");
        expect(html).not.toContain("data:text/css");
    });

    it("rejects mapping signals when the validated font is missing", async () => {
        const chapter = createChapter(0, {
            content: "<section style=\"font-family: '1', sans-serif;\"><p>Mapped body</p></section>"
        });

        await expect(buildBookHtml([chapter], createBookMetadata())).rejects.toMatchObject({
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

        const html = await (await buildBookHtml([chapter], createBookMetadata())).text();

        expect(html).toContain("[章节缺失]");
        expect(html).toContain("https://www.esjzone.cc/forum/100/1.html");
    });
});

describe("static HTML export", () => {
    const title = '卷 <一> & "书名"';
    const chapter = createChapter(0, {
        title,
        content: `<main><details open><summary>章末附录</summary><novel-panel><p id="notes" onclick=""><strong>正文</strong> data:text/css <span style="color: red; text-align: center; position: fixed">样式</span></p></novel-panel></details></main>
            <table><tr><td colspan="2">表格</td></tr></table>
            <ruby>字<rt>注音</rt></ruby><a href="https://example.test/reading" target="other">链接</a>
            <a href="chapter.html">地址未知时保留文字</a>
            <a href="#notes">本段</a>
            <img src="img_0_0.jpg" alt="插图" srcset="illustration.jpg">
            <script type="text/plain">页面标记</script><style>article { color: red; }</style>
            <iframe title="嵌入页"></iframe><form><input name="test"></form>`,
        images: [{ id: "img_0_0.jpg", blob: new Blob(["image"], { type: "image/jpeg" }), mediaType: "image/jpeg" }]
    });

    it.each([
        ["book", () => buildBookHtml([chapter], createBookMetadata({ title, author: "A & B" }))],
        [
            "single chapter",
            () => buildCurrentChapterHtml(chapter, { title, author: "A & B", intro: "<简介>", pageUrl: location.href })
        ]
    ] as const)("preserves reading elements and removes page markup from %s", async (_target, build) => {
        const doc = new DOMParser().parseFromString(await (await build()).text(), "text/html");
        const content = doc.querySelector(".content")!;

        expect(doc.title).toBe(title);
        expect(doc.querySelector("h1")?.textContent).toBe(title);
        expect(content.querySelector("main details[open] summary")?.textContent).toBe("章末附录");
        expect(content.querySelector("main details p strong")?.textContent).toBe("正文");
        expect(content.querySelector("novel-panel")).toBeNull();
        expect(content.textContent).toContain("data:text/css");
        expect(content.querySelector("span")?.style.color).toBe("red");
        expect(content.querySelector("span")?.style.textAlign).toBe("center");
        expect(content.querySelector("span")?.style.position).toBe("");
        expect(content.querySelector("table td")?.getAttribute("colspan")).toBe("2");
        expect(content.querySelector("ruby rt")?.textContent).toBe("注音");
        expect(content.querySelector("a")?.getAttribute("href")).toBe("https://example.test/reading");
        expect(content.querySelector("a + a")?.outerHTML).toBe("<a>地址未知时保留文字</a>");
        expect(content.querySelector('a[href="#notes"]')?.textContent).toBe("本段");
        expect(content.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
        expect(content.querySelector("script, style, iframe, form, [onclick], [target], [srcset]")).toBeNull();
        expect(doc.body.textContent).toContain("A & B");
    });
});
