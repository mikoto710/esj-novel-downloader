// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCachedData, createDeferred, createDownloadTask } from "../support";
import { createDownloadButton, createSettingButton } from "../../src/ui/components";
import {
    createDownloadSelectionPopup,
    type DownloadSelectionPopupOptions
} from "../../src/ui/dialogs/download-selection";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";
import { setInterfaceLocalePreference } from "../../src/storage/settings";
import { state } from "../../src/app/page-session";
import { showFormatChoice } from "../../src/ui/popups";

function selectionOptions(overrides: Partial<DownloadSelectionPopupOptions> = {}): DownloadSelectionPopupOptions {
    return {
        tasks: Array.from({ length: 5 }, (_, index) => createDownloadTask(index)),
        cachedIndexes: new Set([1, 3]),
        cacheCount: 2,
        cacheWillBeInvalidated: false,
        imageEnabled: false,
        hasExistingExport: false,
        ...overrides
    };
}

function checkedIndexes(): number[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>("#esj-range-directory input:checked"), (input) =>
        Number(input.dataset.esjSelectIndex)
    );
}

function selectChapters(...indexes: number[]): void {
    document.querySelector<HTMLInputElement>("#esj-download-range")!.click();
    document.querySelector<HTMLButtonElement>("#esj-range-clear-selection")!.click();
    for (const index of indexes) {
        document
            .querySelector<HTMLInputElement>(`#esj-range-directory input[data-esj-select-index="${index}"]`)!
            .click();
    }
}

describe("unified download selection UI", () => {
    beforeEach(() => {
        state.cachedData = null;
        state.runtimeCacheSession = null;
        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();
    });

    it("preserves a sparse selection through locale changes and cache reconfirmation", async () => {
        const selected = { mode: "selected" as const, sourceTotalChapters: 5, indexes: [0, 2, 4] };
        const popup = createDownloadSelectionPopup(
            selectionOptions({
                initialSelection: selected,
                cacheWillBeInvalidated: true,
                tasks: Array.from({ length: 5 }, (_, index) =>
                    createDownloadTask(index, { title: index === 1 || index === 3 ? "Same title" : `Chapter ${index}` })
                )
            })
        );
        expect(checkedIndexes()).toEqual([0, 2, 4]);
        const filename = document.querySelector<HTMLInputElement>("#esj-download-filename");
        expect(filename).not.toBeNull();
        filename!.value = "阅读清单";
        filename!.dispatchEvent(new Event("input", { bubbles: true }));
        const search = document.querySelector<HTMLInputElement>("#esj-range-search")!;
        search.value = "Ｓａｍｅ";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        const matches = Array.from(document.querySelectorAll<HTMLElement>("[data-esj-search-index]"));
        expect(matches.map((node) => Number(node.dataset.esjSearchIndex))).toEqual([1, 3]);
        matches[1].click();
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(checkedIndexes()).toEqual([0, 2, 4]);
        expect(search.value).toBe("Ｓａｍｅ");
        expect(filename!.value).toBe("阅读清单");
        expect(
            document.querySelector<HTMLInputElement>('#esj-range-directory input[data-esj-select-index="1"]')!.checked
        ).toBe(false);
        document.querySelector<HTMLInputElement>("#esj-download-all")!.click();
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")!.disabled).toBe(false);
        document.querySelector<HTMLInputElement>("#esj-download-range")!.click();
        expect(checkedIndexes()).toEqual([0, 2, 4]);
        document.querySelector<HTMLButtonElement>("#esj-range-download")!.click();
        await expect(popup.decision).resolves.toEqual({
            action: "download",
            selection: selected,
            filename: "阅读清单"
        });
    });

    it("does not allow a download until preparation supplies the directory", async () => {
        const popup = createDownloadSelectionPopup(selectionOptions({ preparationStage: "reading-book" }));
        expect(document.querySelector<HTMLInputElement>("#esj-download-all")?.disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(true);

        popup.showReady(selectionOptions());
        selectChapters(1, 2, 3);
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(popup.decision).resolves.toEqual({
            action: "download",
            selection: { mode: "selected", sourceTotalChapters: 5, indexes: [1, 2, 3] }
        });
    });

    it("ignores preparation results after the previous-export decision closes its window", async () => {
        const popup = createDownloadSelectionPopup(
            selectionOptions({ preparationStage: "reading-book", hasExistingExport: true })
        );
        document.querySelector<HTMLButtonElement>("#esj-range-open-previous")?.click();
        await expect(popup.decision).resolves.toEqual({ action: "open-existing" });

        const next = createDownloadSelectionPopup(selectionOptions());
        popup.showPreparing("checking-cache");
        popup.showReady(selectionOptions({ preparationErrorKey: "page.cacheUnavailable.message" }));
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(false);
        next.close();
        await expect(next.decision).resolves.toEqual({ action: "cancel" });
    });

    it("retains chapter selections when switching download modes", async () => {
        const { decision } = createDownloadSelectionPopup(selectionOptions());
        selectChapters(1, 2, 3);
        expect(checkedIndexes()).toEqual([1, 2, 3]);

        document.querySelector<HTMLInputElement>("#esj-download-all")?.click();
        document.querySelector<HTMLInputElement>("#esj-download-range")?.click();
        expect(checkedIndexes()).toEqual([1, 2, 3]);
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "selected", sourceTotalChapters: 5, indexes: [1, 2, 3] }
        });
    });

    it("previews only selected cached chapters and preserves selection across locale changes", async () => {
        document.body.innerHTML = '<button class="esj-settings-trigger"></button>';
        const { decision } = createDownloadSelectionPopup(
            selectionOptions({ cachedIndexes: new Set([0, 1, 3]), cacheCount: 3 })
        );
        selectChapters(1, 2, 3);

        expect(document.querySelector("#esj-range-cache-reuse")?.textContent?.match(/\d+/g)).toEqual(["2"]);

        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(checkedIndexes()).toEqual([1, 2, 3]);
        expect(document.querySelector<HTMLInputElement>("#esj-download-range")?.checked).toBe(true);

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "selected", sourceTotalChapters: 5, indexes: [1, 2, 3] }
        });
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("retains the chosen range when a changed cache requires another confirmation", async () => {
        const selection = { mode: "range" as const, sourceTotalChapters: 5, startIndex: 1, endIndex: 3 };
        const { decision } = createDownloadSelectionPopup(
            selectionOptions({ initialSelection: selection, cacheWillBeInvalidated: true })
        );

        expect(document.querySelector<HTMLInputElement>("#esj-download-range")?.checked).toBe(true);
        expect(checkedIndexes()).toEqual([1, 2, 3]);
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "selected", sourceTotalChapters: 5, indexes: [1, 2, 3] }
        });
    });

    it("keeps the previous range export available when cache preparation fails", async () => {
        const { decision } = createDownloadSelectionPopup(
            selectionOptions({
                hasExistingExport: true,
                existingSelection: { mode: "range", sourceTotalChapters: 10, startChapter: 2, endChapter: 3 },
                preparationErrorKey: "page.cacheUnavailable.message"
            })
        );

        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(true);
        const previous = document.querySelector<HTMLButtonElement>("#esj-range-open-previous")!;
        expect(previous.disabled).toBe(false);
        expect(document.activeElement).toBe(previous);
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(true);
        previous.click();
        await expect(decision).resolves.toEqual({ action: "open-existing" });
        expect(document.querySelector("#esj-range-selection")).toBeNull();
    });

    it("keeps page actions locked until the chosen task settles", async () => {
        const flow = createDeferred<void>();
        const button = createDownloadButton("download", undefined, async () => {
            const decision = await createDownloadSelectionPopup(selectionOptions()).decision;
            if (decision.action === "download") {
                await flow.promise;
            }
        }) as HTMLButtonElement;
        const settings = createSettingButton() as HTMLButtonElement;
        document.body.append(button, settings);

        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).not.toBeNull());
        expect(button.disabled && settings.disabled).toBe(true);
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).toBeNull());
        expect(button.disabled && settings.disabled).toBe(true);

        flow.resolve(undefined);
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(settings.disabled).toBe(false);
    });

    it("restores the disabled state that existed before the selection dialog", async () => {
        document.body.innerHTML =
            '<button id="download" class="esj-download-trigger" disabled></button><button class="esj-settings-trigger"></button>';
        const { decision } = createDownloadSelectionPopup(selectionOptions());

        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
        expect(document.querySelector<HTMLButtonElement>("#download")?.disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("keeps page actions locked until the selected previous-export dialog closes", async () => {
        const previous = createCachedData();
        const button = createDownloadButton("download", undefined, async () => {
            const decision = await createDownloadSelectionPopup(selectionOptions({ hasExistingExport: true })).decision;
            if (decision.action === "open-existing") {
                showFormatChoice(previous);
            }
        }) as HTMLButtonElement;
        const settings = createSettingButton() as HTMLButtonElement;
        document.body.append(button, settings);

        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).not.toBeNull());
        document.querySelector<HTMLButtonElement>("#esj-range-open-previous")?.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-format")).not.toBeNull());
        expect(button.disabled && settings.disabled).toBe(true);

        document.querySelector<HTMLButtonElement>("#esj-format .esj-common-header button")?.click();
        expect(button.disabled || settings.disabled).toBe(false);
    });
});
