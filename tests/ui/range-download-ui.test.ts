// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred, createDownloadTask } from "../support";
import { injectDetailButton } from "../../src/ui/detail";
import { injectForumButton } from "../../src/ui/forum";
import { createDownloadButton, createRangeDownloadButton } from "../../src/ui/components";
import { createRangeSelectionPopup } from "../../src/ui/range-selection-popup";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { state } from "../../src/core/state";
import { createConfirmPopup, showFormatChoice } from "../../src/ui/popups";

function setRangeExportData(): void {
    state.cachedData = {
        txt: "",
        chapters: [],
        metadata: {
            title: "Book",
            author: "Author",
            description: "",
            tags: [],
            coverBlob: null,
            coverExt: "jpg"
        },
        epubBlob: null,
        exportContext: {
            bookId: "1",
            pageUrl: "https://www.esjzone.cc/detail/1.html",
            sourcePageType: "detail",
            imageEnabled: false,
            selection: { mode: "range", sourceTotalChapters: 10, startChapter: 2, endChapter: 3 }
        }
    };
}

describe("range download UI", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        state.cachedData = null;
        state.globalChaptersMap = new Map();
        state.runtimeCacheSession = null;
        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();
    });

    it("injects separate detail and forum range buttons once and in the expected order", () => {
        document.body.innerHTML = '<div class="sp-buttons"></div>';
        injectDetailButton();
        injectDetailButton();
        expect(Array.from(document.querySelectorAll(".sp-buttons button")).map((button) => button.id)).toEqual([
            "btn-download-book",
            "btn-download-book-range",
            ""
        ]);

        document.body.innerHTML = '<div class="forum-list-page"><div class="column"></div></div>';
        injectForumButton();
        injectForumButton();
        expect(
            Array.from(document.querySelectorAll(".forum-list-page .column button")).map((button) => button.id)
        ).toEqual(["btn-download-forum", "btn-download-forum-range", ""]);
    });

    it("keeps page actions locked and the range entry preparing until its flow settles", async () => {
        const flow = createDeferred<void>();
        const fullButton = createDownloadButton("full", undefined, async () => undefined) as HTMLButtonElement;
        const rangeButton = createRangeDownloadButton("range", async () => {
            const decision = await createRangeSelectionPopup({
                tasks: [createDownloadTask(0), createDownloadTask(1)],
                cachedIndexes: new Set(),
                cacheWillBeInvalidated: false,
                hasExistingRange: false
            });
            if (decision.action === "download") {
                await flow.promise;
            }
        }) as HTMLButtonElement;
        const settingButton = document.createElement("button");
        settingButton.className = "esj-settings-trigger";
        document.body.append(fullButton, rangeButton, settingButton);

        rangeButton.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).not.toBeNull());
        expect([fullButton, rangeButton, settingButton].every((button) => button.disabled)).toBe(true);
        expect(rangeButton.textContent).toContain("准备中");

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).toBeNull());
        expect([fullButton, rangeButton, settingButton].every((button) => button.disabled)).toBe(true);
        expect(rangeButton.textContent).toContain("准备中");

        flow.resolve(undefined);
        await vi.waitFor(() => expect(rangeButton.disabled).toBe(false));
        expect([fullButton, rangeButton, settingButton].every((button) => !button.disabled)).toBe(true);
        expect(rangeButton.textContent).toContain("范围下载");
    });

    it("restores the disabled state that existed before the range dialog", async () => {
        document.body.innerHTML =
            '<button id="full" class="esj-download-trigger" disabled></button><button class="esj-settings-trigger"></button>';
        const decision = createRangeSelectionPopup({
            tasks: [createDownloadTask(0)],
            cachedIndexes: new Set(),
            cacheWillBeInvalidated: false,
            hasExistingRange: false
        });

        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
        expect(document.querySelector<HTMLButtonElement>("#full")?.disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("validates a continuous range, previews cached chapters, and preserves inputs across locale changes", async () => {
        document.body.innerHTML = '<button class="esj-settings-trigger"></button>';
        const tasks = Array.from({ length: 5 }, (_, index) => createDownloadTask(index));
        const decision = createRangeSelectionPopup({
            tasks,
            cachedIndexes: new Set([1, 3]),
            cacheWillBeInvalidated: false,
            hasExistingRange: false
        });
        const start = document.querySelector<HTMLInputElement>("#esj-range-start")!;
        const end = document.querySelector<HTMLInputElement>("#esj-range-end")!;
        const download = document.querySelector<HTMLButtonElement>("#esj-range-download")!;

        start.value = "0";
        start.dispatchEvent(new Event("input"));
        expect(download.disabled).toBe(true);

        start.value = "2";
        end.value = "4";
        end.dispatchEvent(new Event("input"));
        expect(download.disabled).toBe(false);
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("3 章");
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("2 章缓存");

        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(start.value).toBe("2");
        expect(end.value).toBe("4");
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("快取");

        download.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 5, startIndex: 1, endIndex: 3 }
        });
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("lets the range entry reopen an existing range export", async () => {
        const decision = createRangeSelectionPopup({
            tasks: [createDownloadTask(0)],
            cachedIndexes: new Set(),
            cacheWillBeInvalidated: false,
            hasExistingRange: true
        });

        document.querySelector<HTMLButtonElement>("#esj-range-open-previous")?.click();

        await expect(decision).resolves.toEqual({ action: "open-existing" });
    });

    it("requires confirmation before the full-book button replaces a range export", async () => {
        const scrape = vi.fn(async () => undefined);
        setRangeExportData();
        const button = createDownloadButton("full", undefined, scrape);
        document.body.appendChild(button);

        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-replace-confirm")).not.toBeNull());
        expect(scrape).not.toHaveBeenCalled();
        expect(button.textContent).toContain("准备中");
        document.querySelector<HTMLButtonElement>("#esj-range-replace-continue")?.click();
        await vi.waitFor(() => expect(scrape).toHaveBeenCalledOnce());
    });

    it("restores the full-book label when replacing a range export is cancelled", async () => {
        const scrape = vi.fn(async () => undefined);
        setRangeExportData();
        const button = createDownloadButton("full", undefined, scrape);
        document.body.appendChild(button);

        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-replace-confirm")).not.toBeNull());
        expect(button.textContent).toContain("准备中");
        document.querySelector<HTMLButtonElement>("#esj-range-replace-cancel")?.click();

        await vi.waitFor(() => expect(button.textContent).toContain("全本下载"));
        expect(scrape).not.toHaveBeenCalled();
    });

    it("restores the full-book entry when the download confirmation is cancelled after replacing a range", async () => {
        setRangeExportData();
        const scrape = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    createConfirmPopup(resolve, resolve);
                })
        );
        const fullButton = createDownloadButton("full", undefined, scrape) as HTMLButtonElement;
        const rangeButton = createRangeDownloadButton("range", async () => undefined) as HTMLButtonElement;
        const settingButton = document.createElement("button");
        settingButton.className = "esj-settings-trigger";
        document.body.append(fullButton, rangeButton, settingButton);

        fullButton.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-replace-confirm")).not.toBeNull());
        expect([fullButton, rangeButton, settingButton].every((button) => button.disabled)).toBe(true);

        document.querySelector<HTMLButtonElement>("#esj-range-replace-continue")?.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-confirm")).not.toBeNull());
        expect(fullButton.textContent).toContain("准备中");
        document.querySelector<HTMLButtonElement>("#esj-confirm-cancel")?.click();

        await vi.waitFor(() => expect(fullButton.disabled).toBe(false));
        expect([fullButton, rangeButton, settingButton].every((button) => !button.disabled)).toBe(true);
        expect(fullButton.textContent).toContain("全本下载");
        expect(state.cachedData?.exportContext?.selection?.mode).toBe("range");
    });

    it("keeps page actions locked until the range export dialog closes", async () => {
        setRangeExportData();
        const fullButton = createDownloadButton("full", undefined, async () => undefined) as HTMLButtonElement;
        const rangeButton = createRangeDownloadButton("range", async () => showFormatChoice()) as HTMLButtonElement;
        const settingButton = document.createElement("button");
        settingButton.className = "esj-settings-trigger";
        document.body.append(fullButton, rangeButton, settingButton);

        rangeButton.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-format")).not.toBeNull());
        expect([fullButton, rangeButton, settingButton].every((button) => button.disabled)).toBe(true);

        document.querySelector<HTMLButtonElement>("#esj-format .esj-common-header button")?.click();
        expect([fullButton, rangeButton, settingButton].every((button) => !button.disabled)).toBe(true);
    });
});
