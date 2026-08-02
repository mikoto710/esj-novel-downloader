// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../src/core/state";
import { confirmMappingFontDownload, showFormatChoice } from "../src/ui/popups";
import { createCachedData, createChapter, createDownloadTask } from "./support";

function createMappedChapter() {
    return createChapter(0, {
        content: "<section style=\"font-family: '1', sans-serif;\"><p>Mapped body</p></section>",
        mappingFont: {
            family: "1",
            blob: new Blob([new Uint8Array(64)], { type: "font/woff2" }),
            mediaType: "font/woff2",
            sha256: "a".repeat(64)
        }
    });
}

describe("mapped font export UI", () => {
    beforeEach(() => {
        state.cachedData = null;
        state.originalTitle = "ESJZone Test";
    });

    it("disables TXT visibly while keeping HTML and EPUB available", () => {
        state.cachedData = createCachedData({ chapters: [createMappedChapter()] });

        showFormatChoice();

        const txt = document.querySelector("#esj-txt") as HTMLButtonElement;
        const epub = document.querySelector("#esj-epub") as HTMLButtonElement;
        const html = document.querySelector("#esj-html") as HTMLButtonElement;
        expect(txt.disabled).toBe(true);
        expect(txt.textContent).toContain("TXT 不可用");
        expect(epub.disabled).toBe(false);
        expect(html.disabled).toBe(false);
        expect(document.querySelector("#esj-format-mapping-warning")?.textContent).toContain("TXT 已禁用");
        expect(document.querySelector("#esj-format")?.textContent).toContain("映射正文尚未恢复为真实 Unicode");
    });

    it("shows a second confirmation before generating a mapped EPUB", () => {
        state.cachedData = createCachedData({ chapters: [createMappedChapter()] });
        showFormatChoice();

        (document.querySelector("#esj-epub") as HTMLButtonElement).click();

        expect(document.querySelector("#esj-mapping-export-confirm")?.textContent).toContain("确认生成 EPUB");
        expect(document.querySelector("#esj-mapping-export-confirm")?.textContent).toContain(
            "复制、搜索和朗读可能不正确"
        );
    });

    it("keeps TXT enabled for a normal book", () => {
        state.cachedData = createCachedData({ chapters: [createChapter()] });

        showFormatChoice();

        expect((document.querySelector("#esj-txt") as HTMLButtonElement).disabled).toBe(false);
        expect(document.querySelector("#esj-format-mapping-warning")).toBeNull();
    });

    it("requires an explicit choice when the download first detects a mapped chapter", async () => {
        const confirmation = confirmMappingFontDownload({
            task: createDownloadTask(),
            chapterCount: 1,
            fontBytes: 64,
            inFlightLimit: 5
        });

        expect(document.querySelector("#esj-mapping-confirm")?.textContent).toContain("继续下载（仅 HTML/EPUB）");
        expect(document.querySelector("#esj-mapping-inflight-warning")?.textContent).toContain(
            "进度最多还可能增加 5 章"
        );
        expect(document.querySelector("#esj-mapping-inflight-warning")?.textContent).toContain("已停止领取新章节");
        (document.querySelector("#esj-mapping-stop") as HTMLButtonElement).click();

        await expect(confirmation).resolves.toBe(false);
    });

    it("states that no new requests are in flight when consent comes from restored cache", async () => {
        const confirmation = confirmMappingFontDownload({
            task: createDownloadTask(),
            chapterCount: 3,
            fontBytes: 192,
            inFlightLimit: 0
        });

        expect(document.querySelector("#esj-mapping-inflight-warning")?.textContent).toContain("尚未发出新的章节请求");
        (document.querySelector("#esj-mapping-stop") as HTMLButtonElement).click();

        await expect(confirmation).resolves.toBe(false);
    });
});
