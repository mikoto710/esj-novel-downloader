// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildHtml } from "../src/core/html";
import { createBookMetadata, createChapter } from "./support";

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

        await expect(buildHtml([chapter], createBookMetadata())).rejects.toThrow("缺少已校验的映射字体");
    });
});
