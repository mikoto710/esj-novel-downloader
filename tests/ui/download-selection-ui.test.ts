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
import { publishInterfaceLocaleChange, t } from "../../src/ui/locale";
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

    it("injects one download entry followed by settings without disturbing native buttons", () => {
        document.body.innerHTML =
            '<div class="sp-buttons"><button id="favorite"></button><button id="edit"></button></div>';
        injectDetailButton();
        injectDetailButton();
        expect(Array.from(document.querySelectorAll(".sp-buttons button")).map((button) => button.id)).toEqual([
            "favorite",
            "edit",
            "btn-download-book",
            ""
        ]);

        document.body.innerHTML =
            '<div class="forum-list-page"><div class="column"><button id="new-thread"></button></div></div>';
        injectForumButton();
        injectForumButton();
        expect(
            Array.from(document.querySelectorAll(".forum-list-page .column button")).map((button) => button.id)
        ).toEqual(["new-thread", "btn-download-forum", ""]);
    });

    it("defaults to the whole book and shows the fixed image setting", async () => {
        const decision = createDownloadSelectionPopup(selectionOptions({ imageEnabled: true }));

        expect(document.querySelector<HTMLInputElement>("#esj-download-all")?.checked).toBe(true);
        expect(document.querySelector("#esj-download-mode select")).toBeNull();
        expect(document.querySelector<HTMLElement>("#esj-range-fields")?.style.display).toBe("none");
        expect(document.querySelector<HTMLElement>("#esj-range-validation")?.style.display).toBe("none");
        expect(document.querySelector<HTMLElement>("#esj-range-all-warning")?.style.display).toBe("none");
        expect(document.querySelector("#esj-range-stop-warning")).toBeNull();
        expect(document.querySelector<HTMLInputElement>("#esj-range-start")?.disabled).toBe(true);
        expect(document.querySelector<HTMLInputElement>("#esj-range-end")?.disabled).toBe(true);
        expect(document.querySelector("#esj-download-images")?.textContent).toBe("🖼️ 正文插图：开启");
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("5 章");
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("2 章缓存");

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "all", sourceTotalChapters: 5, startIndex: 0, endIndex: 4 }
        });
    });

    it("reveals range fields on demand and retains input when switching back", async () => {
        const decision = createDownloadSelectionPopup(selectionOptions());
        selectRange("2", "4");
        expect(document.querySelector<HTMLElement>("#esj-range-fields")?.style.display).toBe("flex");
        expect(document.querySelector<HTMLInputElement>("#esj-range-start")?.disabled).toBe(false);

        document.querySelector<HTMLInputElement>("#esj-download-all")?.click();
        expect(document.querySelector<HTMLElement>("#esj-range-fields")?.style.display).toBe("none");
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("5 章");
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

        expect(document.querySelector<HTMLElement>("#esj-range-all-warning")?.style.display).toBe("block");
        expect(document.querySelector("#esj-range-all-warning")?.textContent).toContain("成功后清理本书缓存");
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();

        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "all", sourceTotalChapters: 5, startIndex: 0, endIndex: 4 }
        });
    });

    it.each([
        ["0", "3"],
        ["2", "6"],
        ["4", "2"],
        ["1.5", "3"],
        ["", "3"],
        ["1", ""]
    ])("rejects the invalid range %s..%s without closing the dialog", async (start, end) => {
        const decision = createDownloadSelectionPopup(selectionOptions());
        selectRange(start, end);
        const download = document.querySelector<HTMLButtonElement>("#esj-range-download")!;

        expect(download.disabled).toBe(true);
        expect(document.querySelector("#esj-range-validation")?.textContent).toContain("整数");
        download.click();
        expect(document.querySelector("#esj-range-selection")).not.toBeNull();
        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("previews only selected cached chapters and preserves selection across locale changes", async () => {
        document.body.innerHTML = '<button class="esj-settings-trigger"></button>';
        const decision = createDownloadSelectionPopup(selectionOptions());
        selectRange("2", "4");
        const start = document.querySelector<HTMLInputElement>("#esj-range-start")!;
        const end = document.querySelector<HTMLInputElement>("#esj-range-end")!;
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("3 章");
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("2 章缓存");
        expect(document.querySelector<HTMLElement>("#esj-range-all-warning")?.style.display).toBe("none");
        expect(document.querySelector("#esj-range-start-title")?.textContent).toContain("第 2 章");
        expect(document.querySelector("#esj-range-end-title")?.textContent).toContain("第 4 章");

        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(start.value).toBe("2");
        expect(end.value).toBe("4");
        expect(document.querySelector<HTMLInputElement>("#esj-download-range")?.checked).toBe(true);
        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("快取");
        expect(document.querySelector("#esj-download-images")?.textContent).toBe("🖼️ 正文插圖：關閉");

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await expect(decision).resolves.toEqual({
            action: "download",
            selection: { mode: "range", sourceTotalChapters: 5, startIndex: 1, endIndex: 3 }
        });
        expect(document.querySelector<HTMLButtonElement>(".esj-settings-trigger")?.disabled).toBe(false);
    });

    it("shows zero reuse and warns about whole-book invalidation outside the selected range", async () => {
        const decision = createDownloadSelectionPopup(
            selectionOptions({ cacheWillBeInvalidated: true, cacheCount: 300 })
        );
        selectRange("2", "3");

        expect(document.querySelector("#esj-range-summary")?.textContent).toContain("复用 0 章缓存");
        expect(document.querySelector("#esj-range-cache-warning")?.textContent).toContain("300 章缓存");
        expect(document.querySelector("#esj-range-cache-warning")?.textContent).toContain("所选范围之外");
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.textContent).toBe("清除缓存并下载");
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(document.querySelector("#esj-range-cache-warning")?.textContent).toContain("300 章快取");
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.textContent).toBe("清除快取並下載");
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
        expect(document.querySelector("#esj-range-validation")?.textContent).toBe(t("page.cacheUnavailable.message"));
        const previous = document.querySelector<HTMLButtonElement>("#esj-range-open-previous")!;
        expect(previous.disabled).toBe(false);
        expect(previous.textContent).toContain("再次导出上次结果");
        expect(previous.textContent).toContain("2–3");
        expect(document.activeElement).toBe(previous);
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(document.querySelector("#esj-range-validation")?.textContent).toBe(t("page.cacheUnavailable.message"));
        expect(document.querySelector("#esj-range-validation")?.textContent).toContain("瀏覽器儲存權限");
        expect(previous.textContent).toContain("再次匯出");
        expect(document.querySelector<HTMLButtonElement>("#esj-range-download")?.disabled).toBe(true);
        previous.click();
        await expect(decision).resolves.toEqual({ action: "open-existing" });
    });

    it("labels the previous whole-book result independently of the newly selected range", async () => {
        const decision = createDownloadSelectionPopup(selectionOptions({ hasExistingExport: true }));
        selectRange("2", "3");
        const previous = document.querySelector<HTMLButtonElement>("#esj-range-open-previous")!;

        expect(previous.textContent).toContain("全本下载");
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        expect(previous.textContent).toContain("再次匯出上次結果（全本下載）");
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

        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).not.toBeNull());
        expect(button.disabled && settings.disabled).toBe(true);
        expect(button.textContent).toContain("准备中");
        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).toBeNull());
        expect(button.disabled && settings.disabled).toBe(true);
        expect(button.textContent).toContain("准备中");

        flow.resolve(undefined);
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(settings.disabled).toBe(false);
        expect(button.textContent?.trim()).toBe("下载");
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

        button.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-range-selection")).not.toBeNull());
        expect(scrape).toHaveBeenCalledOnce();
        expect(document.querySelector("#esj-range-replace-confirm")).toBeNull();
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        document.querySelector<HTMLButtonElement>("#esj-range-cancel")?.click();

        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(settings.disabled).toBe(false);
        expect(button.textContent?.trim()).toBe("下載");
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
