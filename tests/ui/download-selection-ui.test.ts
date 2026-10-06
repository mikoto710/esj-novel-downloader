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

function selectRange(startChapter: string, endChapter: string): void {
    document.querySelector<HTMLInputElement>("#esj-download-range")!.click();
    document.querySelector<HTMLInputElement>("#esj-range-start")!.value = startChapter;
    const end = document.querySelector<HTMLInputElement>("#esj-range-end")!;
    end.value = endChapter;
    end.dispatchEvent(new Event("input"));
}

describe("unified download selection UI", () => {
    beforeEach(() => {
        state.cachedData = null;
        state.runtimeCacheSession = null;
        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();
    });

    it("enables range inputs and retains their values when switching back", async () => {
        const decision = createDownloadSelectionPopup(selectionOptions());
        selectRange("2", "4");
        expect(document.querySelector<HTMLInputElement>("#esj-range-start")?.disabled).toBe(false);

        document.querySelector<HTMLInputElement>("#esj-download-all")?.click();
        document.querySelector<HTMLInputElement>("#esj-download-range")?.click();
        expect(document.querySelector<HTMLInputElement>("#esj-range-start")?.value).toBe("2");
        expect(document.querySelector<HTMLInputElement>("#esj-range-end")?.value).toBe("4");
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 5, startIndex: 1, endIndex: 3 }
        });
    });

    it("previews only selected cached chapters and preserves selection across locale changes", async () => {
        document.body.innerHTML = '<button class="esj-settings-trigger"></button>';
        const decision = createDownloadSelectionPopup(
            selectionOptions({ cachedIndexes: new Set([0, 1, 3]), cacheCount: 3 })
        );
        selectRange("2", "4");
        const start = document.querySelector<HTMLInputElement>("#esj-range-start")!;
        const end = document.querySelector<HTMLInputElement>("#esj-range-end")!;
        expect(document.querySelector("#esj-range-cache-reuse")?.textContent?.match(/\d+/g)).toEqual(["2"]);

        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(start.value).toBe("2");
        expect(end.value).toBe("4");
        expect(document.querySelector<HTMLInputElement>("#esj-download-range")?.checked).toBe(true);

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 5, startIndex: 1, endIndex: 3 }
        });
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("retains the chosen range when a changed cache requires another confirmation", async () => {
        const selection = { mode: "range" as const, sourceTotalChapters: 5, startIndex: 1, endIndex: 3 };
        const decision = createDownloadSelectionPopup(
            selectionOptions({ initialSelection: selection, cacheWillBeInvalidated: true })
        );

        expect(document.querySelector<HTMLInputElement>("#esj-download-range")?.checked).toBe(true);
        expect(document.querySelector<HTMLInputElement>("#esj-range-start")?.value).toBe("2");
        expect(document.querySelector<HTMLInputElement>("#esj-range-end")?.value).toBe("4");
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({ action: "download", selection });
    });

    it("keeps the previous range export available when cache preparation fails", async () => {
        const decision = createDownloadSelectionPopup(
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
            const decision = await createDownloadSelectionPopup(selectionOptions());
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
        const decision = createDownloadSelectionPopup(selectionOptions());

        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
        expect(document.querySelector<HTMLButtonElement>("#download")?.disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("keeps page actions locked until the selected previous-export dialog closes", async () => {
        const previous = createCachedData();
        const button = createDownloadButton("download", undefined, async () => {
            const decision = await createDownloadSelectionPopup(selectionOptions({ hasExistingExport: true }));
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
