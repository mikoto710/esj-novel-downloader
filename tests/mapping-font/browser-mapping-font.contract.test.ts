// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { createDownloadTask } from "../support";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

describe("browser mapped font contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
    });

    it("keeps mapped chapter content normalized when image downloads are disabled", async () => {
        const bytes = new Uint8Array(64);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, 0x774f4632, false);
        view.setUint32(8, bytes.byteLength, false);
        const fontDataUrl = `data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}`;
        const css = `@font-face { font-family: '1'; src: url('${fontDataUrl}') format('woff2'); font-display: swap; }`;
        mocks.parseChapterHtml.mockReturnValue({
            title: "Mapped chapter",
            author: "",
            contentHtml: `<link rel="stylesheet" href="data:text/css,${encodeURIComponent(css)}"><section style="font-family: '1', sans-serif;"><p>Mapped body</p><img src="cover.jpg"></section>`,
            contentText: "Mapped body",
            bookName: "Test book"
        });

        await runtime.batchDownload(createBrowserDownloadOptions([createDownloadTask()]));

        const chapter = runtime.state.cachedData?.chapters[0];
        expect(chapter?.mappingFont?.family).toBe("1");
        expect(chapter?.content).not.toContain("data:text/css");
        expect(chapter?.content).not.toContain("<img");
        expect(chapter?.content).toContain("font-family: '1', sans-serif");
    });
});
