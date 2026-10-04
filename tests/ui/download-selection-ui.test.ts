// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCachedData, createDeferred, createDownloadTask } from "../support";
import { injectDetailButton } from "../../src/ui/pages/detail";
import { injectForumButton } from "../../src/ui/pages/forum";
import { createDownloadButton, createSettingButton } from "../../src/ui/components";
import {
    createDownloadSelectionPopup,
    type DownloadSelectionPopupOptions
} from "../../src/ui/dialogs/download-selection";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { state } from "../../src/core/state";
import { showFormatChoice } from "../../src/ui/popups";

vi.mock("../../src/scrapers/detail", () => ({ scrapeDetail: vi.fn() }));
vi.mock("../../src/scrapers/forum", () => ({ scrapeForum: vi.fn() }));

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

    it("injects each entry once without removing native buttons", () => {
        document.body.innerHTML =
            '<div class="sp-buttons"><button id="favorite"></button><button id="edit"></button></div>';
        injectDetailButton();
        injectDetailButton();
        expect(document.querySelector("#favorite")).not.toBeNull();
        expect(document.querySelector("#edit")).not.toBeNull();
        expect(document.querySelectorAll("#btn-download-book")).toHaveLength(1);
        expect(document.querySelectorAll(".esj-settings-trigger")).toHaveLength(1);

        document.body.innerHTML =
            '<div class="forum-list-page"><div class="column"><button id="new-thread"></button></div></div>';
        injectForumButton();
        injectForumButton();
        expect(document.querySelector("#new-thread")).not.toBeNull();
        expect(document.querySelectorAll("#btn-download-forum")).toHaveLength(1);
        expect(document.querySelectorAll(".esj-settings-trigger")).toHaveLength(1);
    });

    it("defaults to the whole book and disables range inputs", async () => {
        const decision = createDownloadSelectionPopup(selectionOptions({ imageEnabled: true }));

        expect(document.querySelector<HTMLInputElement>("#esj-download-all")?.checked).toBe(true);
        expect(document.querySelector<HTMLInputElement>("#esj-range-start")?.disabled).toBe(true);
        expect(document.querySelector<HTMLInputElement>("#esj-range-end")?.disabled).toBe(true);

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "all", sourceTotalChapters: 5, startIndex: 0, endIndex: 4 }
        });
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

    it("normalizes a manually selected 1..N range to whole-book behavior", async () => {
        const decision = createDownloadSelectionPopup(selectionOptions());
        selectRange("1", "5");

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();

        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "all", sourceTotalChapters: 5, startIndex: 0, endIndex: 4 }
        });
    });

    it.each([
        ["4", "2"],
        ["", "3"]
    ])("rejects the invalid range %s..%s without closing the dialog", async (start, end) => {
        const decision = createDownloadSelectionPopup(selectionOptions());
        selectRange(start, end);
        const download = document.querySelector<HTMLButtonElement>("#esj-range-download")!;

        expect(download.disabled).toBe(true);
        expect(document.querySelector("#esj-range-validation")?.textContent).toBeTruthy();
        download.click();
        expect(document.querySelector("#esj-range-selection")).not.toBeNull();
        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("previews only selected cached chapters and preserves selection across locale changes", async () => {
        document.body.innerHTML = '<button class="esj-settings-trigger"></button>';
        const decision = createDownloadSelectionPopup(
            selectionOptions({ cachedIndexes: new Set([0, 1, 3]), cacheCount: 3 })
        );
        selectRange("2", "4");
        const start = document.querySelector<HTMLInputElement>("#esj-range-start")!;
        const end = document.querySelector<HTMLInputElement>("#esj-range-end")!;
        const summary = document.querySelector("#esj-range-summary")!;
        const previousSummary = summary.textContent;
        expect(previousSummary).toContain("3");
        expect(document.querySelector("#esj-range-cache-reuse")?.textContent?.match(/\d+/g)).toEqual(["2"]);

        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(start.value).toBe("2");
        expect(end.value).toBe("4");
        expect(summary.textContent).not.toBe(previousSummary);
        expect(document.querySelector<HTMLInputElement>("#esj-download-range")?.checked).toBe(true);

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 5, startIndex: 1, endIndex: 3 }
        });
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("warns about whole-book inventory before a range download", async () => {
        const decision = createDownloadSelectionPopup(
            selectionOptions({ cacheWillBeInvalidated: true, cacheCount: 300 })
        );
        selectRange("2", "3");

        expect(document.querySelector("#esj-range-cache-warning")?.textContent).toContain("300");
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(document.querySelector("#esj-range-cache-warning")?.textContent).toContain("300");
        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
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
        const validation = document.querySelector("#esj-range-validation")!;
        const errorMessage = validation.textContent;
        expect(errorMessage).toBeTruthy();
        const previous = document.querySelector<HTMLButtonElement>("#esj-range-open-previous")!;
        expect(previous.disabled).toBe(false);
        expect(previous.title).toContain("2–3");
        const previousLabel = previous.textContent;
        const previousDescription = previous.title;
        expect(document.activeElement).toBe(previous);
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(validation.textContent).not.toBe(errorMessage);
        expect(previous.textContent).not.toBe(previousLabel);
        expect(previous.title).not.toBe(previousDescription);
        expect(previous.getAttribute("aria-label")).toContain("2–3");
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(true);
        previous.click();
        await expect(decision).resolves.toEqual({ action: "open-existing" });
        expect(document.querySelector("#esj-range-selection")).toBeNull();
    });

    it("describes the previous whole-book result independently of the newly selected range", async () => {
        const decision = createDownloadSelectionPopup(selectionOptions({ hasExistingExport: true }));
        const previous = document.querySelector<HTMLButtonElement>("#esj-range-open-previous")!;
        const previousLabel = previous.textContent;
        const previousDescription = previous.title;
        selectRange("2", "3");

        expect(previous.textContent).toBe(previousLabel);
        expect(previous.title).toBe(previousDescription);
        previous.click();
        await expect(decision).resolves.toEqual({ action: "open-existing" });
    });

    it("keeps page actions locked and the entry preparing until the chosen task settles", async () => {
        const flow = createDeferred<void>();
        const button = createDownloadButton("download", undefined, async () => {
            const decision = await createDownloadSelectionPopup(selectionOptions());
            if (decision.action === "download") {
                await flow.promise;
            }
        }) as HTMLButtonElement;
        const settings = createSettingButton() as HTMLButtonElement;
        document.body.append(button, settings);

        const idleLabel = button.textContent;
        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).not.toBeNull());
        expect(button.disabled && settings.disabled).toBe(true);
        expect(button.textContent).not.toBe(idleLabel);
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).toBeNull());
        expect(button.disabled && settings.disabled).toBe(true);
        expect(button.textContent).not.toBe(idleLabel);

        flow.resolve(undefined);
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(settings.disabled).toBe(false);
        expect(button.textContent).toBe(idleLabel);
    });

    it("cancels the unified entry without replacing the previous result and restores the current locale", async () => {
        const previous = createCachedData();
        state.cachedData = previous;
        const scrape = vi.fn(async () => {
            await createDownloadSelectionPopup(selectionOptions({ hasExistingExport: true }));
        });
        const button = createDownloadButton("download", undefined, scrape) as HTMLButtonElement;
        const settings = createSettingButton() as HTMLButtonElement;
        document.body.append(button, settings);

        const previousLabel = button.textContent;
        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).not.toBeNull());
        expect(scrape).toHaveBeenCalledOnce();
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();

        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(settings.disabled).toBe(false);
        expect(button.textContent).not.toBe(previousLabel);
        expect(state.cachedData).toBe(previous);
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
