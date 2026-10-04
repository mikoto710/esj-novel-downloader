// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { getInterfaceLocalePreference, setInterfaceLocalePreference } from "../../src/core/config";
import { state } from "../../src/core/state";
import { createDownloadButton, createSettingButton } from "../../src/ui/components";
import { createSettingsPanel } from "../../src/ui/popups";
import { installRuntimeInterfaceLocaleSync } from "../../src/ui/locale";

describe("shared locale UI", () => {
    beforeEach(() => {
        setInterfaceLocalePreference("zh-TW");
        state.cachedData = null;
    });

    it("persists the selected interface language from settings and refreshes the open UI", () => {
        const settingButton = createSettingButton();
        document.body.appendChild(settingButton);
        createSettingsPanel();

        const popup = document.querySelector("#esj-settings") as HTMLElement;
        const language = popup.querySelector("#esj-interface-language") as HTMLSelectElement;
        const concurrency = popup.querySelector("#esj-settings-concurrency") as HTMLInputElement;
        const images = popup.querySelector("#esj-settings-images") as HTMLInputElement;
        const previousText = popup.textContent;
        const previousLabel = settingButton.getAttribute("aria-label");
        expect(language.value).toBe("zh-TW");
        expect(Array.from(language.options).map((option) => option.value)).toEqual(["auto", "zh-CN", "zh-TW"]);

        concurrency.value = "7";
        const toggledImageState = !images.checked;
        images.checked = toggledImageState;

        language.value = "zh-CN";
        language.dispatchEvent(new Event("change", { bubbles: true }));

        expect(getInterfaceLocalePreference()).toBe("zh-CN");
        expect(document.querySelector("#esj-settings")).toBe(popup);
        expect(popup.textContent).not.toBe(previousText);
        expect(concurrency.value).toBe("7");
        expect(images.checked).toBe(toggledImageState);
        expect(settingButton.getAttribute("aria-label")).not.toBe(previousLabel);
    });

    it("follows website simplified and traditional switching without reinjecting buttons", async () => {
        setInterfaceLocalePreference("auto");
        document.body.innerHTML =
            '<div class="customizer-text-switch"><button class="trans active" data-encode="0">原</button></div>';
        const settingButton = createSettingButton();
        const downloadButton = createDownloadButton("runtime-download", undefined, async () => undefined);
        document.body.append(settingButton, downloadButton);
        const dispose = installRuntimeInterfaceLocaleSync();

        const previousText = downloadButton.textContent;
        const previousLabel = settingButton.getAttribute("aria-label");
        const websiteSwitch = document.querySelector(".customizer-text-switch .trans") as HTMLElement;
        websiteSwitch.dataset.encode = "1";
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector("#runtime-download")).toBe(downloadButton);
        expect(downloadButton.textContent).not.toBe(previousText);
        expect(settingButton.getAttribute("aria-label")).not.toBe(previousLabel);
        dispose();
    });
});
