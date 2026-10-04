// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../../src/core/state";
import { confirmIncompleteChapters, confirmMappingFontDownload, showFormatChoice } from "../../src/ui/popups";
import { createCachedData, createChapter, createDownloadTask } from "../support";
import { setInterfaceLocalePreference } from "../../src/core/config";

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
        setInterfaceLocalePreference("zh-CN");
        state.cachedData = null;
        state.originalTitle = "ESJZone Test";
    });

    it("disables TXT visibly while keeping HTML and EPUB available", () => {
        state.cachedData = createCachedData({ chapters: [createMappedChapter()] });

        showFormatChoice(state.cachedData);

        const txt = document.querySelector("#esj-txt") as HTMLButtonElement;
        const epub = document.querySelector("#esj-epub") as HTMLButtonElement;
        const html = document.querySelector("#esj-html") as HTMLButtonElement;
        expect(txt.disabled).toBe(true);
        expect(epub.disabled).toBe(false);
        expect(html.disabled).toBe(false);
    });

    it("keeps TXT enabled for a normal book", () => {
        state.cachedData = createCachedData({ chapters: [createChapter()] });

        showFormatChoice(state.cachedData);

        expect((document.querySelector("#esj-txt") as HTMLButtonElement).disabled).toBe(false);
        expect(document.querySelector("#esj-format-mapping-warning")).toBeNull();
    });

    it.each([
        ["#esj-mapping-continue", true],
        ["#esj-mapping-stop", false]
    ] as const)("settles and removes the mapping prompt through %s", async (selector, accepted) => {
        const confirmation = confirmMappingFontDownload({
            task: createDownloadTask(),
            chapterCount: 1,
            fontBytes: 64,
            inFlightLimit: 5
        });
        document.querySelector<HTMLButtonElement>(selector)!.click();

        await expect(confirmation).resolves.toBe(accepted);
        expect(document.querySelector("#esj-mapping-confirm")).toBeNull();
    });

    it("closes as rejection when the task signal aborts", async () => {
        const controller = new AbortController();
        const confirmation = confirmMappingFontDownload(
            { task: createDownloadTask(), chapterCount: 1, fontBytes: 64, inFlightLimit: 1 },
            controller.signal
        );

        controller.abort();

        await expect(confirmation).resolves.toBe(false);
        expect(document.querySelector("#esj-mapping-confirm")).toBeNull();
    });
});

describe("incomplete chapter decision UI", () => {
    it.each([
        ["#esj-incomplete-retry", "retry"],
        ["#esj-incomplete-export", "export-with-placeholders"],
        ["#esj-incomplete-cancel", "cancel"]
    ] as const)("settles and removes the incomplete prompt through %s", async (selector, expected) => {
        const task = createDownloadTask();
        const decision = confirmIncompleteChapters({ missingTasks: [task], totalChapters: 1 });
        expect(document.querySelector("#esj-incomplete-chapters")?.textContent).toContain(task.title);
        document.querySelector<HTMLButtonElement>(selector)!.click();

        await expect(decision).resolves.toBe(expected);
        expect(document.querySelector("#esj-incomplete-chapters")).toBeNull();
    });
    beforeEach(() => {
        setInterfaceLocalePreference("zh-CN");
        document.body.innerHTML = "";
    });

    it("shows selected and source positions for missing range chapters", async () => {
        const task = createDownloadTask(100);
        const decision = confirmIncompleteChapters({
            missingTasks: [task],
            totalChapters: 20,
            sourceTotalChapters: 120,
            selectionMode: "range",
            taskOrderByIndex: new Map([[100, 0]])
        });

        const popup = document.querySelector("#esj-incomplete-chapters")!;
        expect(popup.textContent).toContain("1/20");
        expect(popup.textContent).toContain("101");
        (document.querySelector("#esj-incomplete-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toBe("cancel");
    });

    it("closes as cancellation when the download signal aborts", async () => {
        const controller = new AbortController();
        const decision = confirmIncompleteChapters(
            { missingTasks: [createDownloadTask()], totalChapters: 1 },
            controller.signal
        );

        controller.abort();

        await expect(decision).resolves.toBe("cancel");
        expect(document.querySelector("#esj-incomplete-chapters")).toBeNull();
    });
});
