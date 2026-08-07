// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { getInterfaceLocalePreference, setInterfaceLocalePreference } from "../../src/core/config";
import { state } from "../../src/core/state";
import { createDownloadButton, createSettingButton } from "../../src/ui/components";
import { showMessagePopup } from "../../src/ui/message-popup";
import { createCommonHeader } from "../../src/ui/popup-components";
import { createConfirmPopup, createSettingsPanel } from "../../src/ui/popups";
import { installRuntimeInterfaceLocaleSync } from "../../src/ui/locale";

describe("shared locale UI", () => {
    beforeEach(() => {
        setInterfaceLocalePreference("zh-TW");
        state.globalChaptersMap.clear();
        state.cachedData = null;
    });

    it("uses the selected locale for shared buttons and header controls", () => {
        const settingButton = createSettingButton();
        const downloadButton = createDownloadButton("download", undefined, async () => undefined);
        const header = createCommonHeader(
            "Title",
            () => undefined,
            () => undefined
        );

        expect(settingButton.getAttribute("aria-label")).toBe("腳本設定");
        expect(downloadButton.textContent).toContain("全本下載");
        expect(header.querySelector('[aria-label="最小化"]')).not.toBeNull();
        expect(header.querySelector('[aria-label="關閉"]')).not.toBeNull();
    });

    it("translates message popup defaults without changing caller-provided messages", () => {
        const popup = showMessagePopup({ tone: "warning", message: "Caller message" });

        expect(popup.querySelector(".esj-common-header")?.textContent).toContain("請注意");
        expect(popup.querySelector("#esj-message-summary")?.textContent).toBe("Caller message");
        expect(popup.querySelector("#esj-message-close")?.textContent).toBe("關閉");
    });

    it("persists the selected interface language from settings and refreshes the open UI", () => {
        const settingButton = createSettingButton();
        document.body.appendChild(settingButton);
        createSettingsPanel();

        const popup = document.querySelector("#esj-settings") as HTMLElement;
        const language = popup.querySelector("#esj-interface-language") as HTMLSelectElement;
        expect(popup.textContent).toContain("介面語言");
        expect(language.value).toBe("zh-TW");
        expect(Array.from(language.options).map((option) => option.textContent)).toEqual([
            "自動（跟隨網站）",
            "簡體中文",
            "繁體中文"
        ]);

        language.value = "zh-CN";
        language.dispatchEvent(new Event("change", { bubbles: true }));

        expect(getInterfaceLocalePreference()).toBe("zh-CN");
        expect(document.querySelector("#esj-settings")?.textContent).toContain("界面语言");
        expect(settingButton.getAttribute("aria-label")).toBe("脚本设置");
    });

    it("follows website simplified and traditional switching without reinjecting buttons", async () => {
        setInterfaceLocalePreference("auto");
        document.body.innerHTML =
            '<div class="customizer-text-switch"><button class="trans active" data-encode="0">原</button></div>';
        const settingButton = createSettingButton();
        const downloadButton = createDownloadButton("runtime-download", undefined, async () => undefined);
        document.body.append(settingButton, downloadButton);
        const dispose = installRuntimeInterfaceLocaleSync();

        expect(downloadButton.textContent).toContain("全本下載");
        const websiteSwitch = document.querySelector(".customizer-text-switch .trans") as HTMLElement;
        websiteSwitch.dataset.encode = "1";
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector("#runtime-download")).toBe(downloadButton);
        expect(downloadButton.textContent).toContain("全本下载");
        expect(settingButton.getAttribute("aria-label")).toBe("脚本设置");
        dispose();
    });

    it("uses locale keys for the common download confirmation", () => {
        state.globalChaptersMap.set(0, {
            title: "Chapter 1",
            content: "content",
            txtSegment: "content"
        });
        createConfirmPopup(() => undefined);

        const popup = document.querySelector("#esj-confirm") as HTMLElement;
        expect(popup.querySelector(".esj-common-header")?.textContent).toContain("確認下載");
        expect(popup.textContent).toContain("偵測到已有 1 章快取");
        expect(popup.querySelector("#esj-confirm-cancel")?.textContent).toBe("取消");
        expect(popup.querySelector("#esj-confirm-ok")?.textContent).toBe("確認");
    });
});
