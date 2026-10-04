// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveInterfaceLocale } from "../../src/core/locale";
import {
    detectBrowserInterfaceLocale,
    detectWebsiteInterfaceLocale,
    resolveBrowserInterfaceLocale,
    WEBSITE_LOCALE_SWITCH_SELECTOR
} from "../../src/adapters/browser-locale";
import {
    getInterfaceLocalePreference,
    INTERFACE_LOCALE_PREFERENCE_KEY,
    setInterfaceLocalePreference
} from "../../src/core/config";
import { getUserscriptApiMocks } from "../support";

describe("locale resolution", () => {
    it("prefers a manual locale over website and browser detection", () => {
        expect(resolveInterfaceLocale("zh-CN", "zh-TW", "zh-TW")).toBe("zh-CN");
        expect(resolveInterfaceLocale("zh-TW", "zh-CN", "zh-CN")).toBe("zh-TW");
    });

    it("uses the website locale in auto mode before browser fallback", () => {
        expect(resolveInterfaceLocale("auto", "zh-TW", "zh-CN")).toBe("zh-TW");
        expect(resolveInterfaceLocale("auto", null, "zh-CN")).toBe("zh-CN");
    });

    it.each([
        ["zh-CN", "zh-CN"],
        ["zh-SG", "zh-CN"],
        ["zh-TW", "zh-TW"],
        ["zh-HK", "zh-TW"],
        ["zh-MO", "zh-TW"],
        ["en-US", "zh-TW"],
        [undefined, "zh-TW"]
    ] as const)("maps browser language %s to %s", (language, expected) => {
        expect(detectBrowserInterfaceLocale(language)).toBe(expected);
    });

    it("maps website conversion states to interface locales", () => {
        document.body.innerHTML = `
            <div class="customizer-text-switch">
                <button class="trans" data-encode="2">繁</button>
                <button class="trans active" data-encode="1">简</button>
            </div>
        `;
        expect(detectWebsiteInterfaceLocale(document)).toBe("zh-CN");
        expect(document.querySelector(WEBSITE_LOCALE_SWITCH_SELECTOR)).not.toBeNull();

        document.querySelector<HTMLElement>(WEBSITE_LOCALE_SWITCH_SELECTOR)?.setAttribute("data-encode", "0");
        expect(detectWebsiteInterfaceLocale(document)).toBe("zh-TW");
    });

    it("falls back to the browser when the website switch is absent or unknown", () => {
        document.body.innerHTML = `<div class="customizer-text-switch"><button class="trans active" data-encode="3">?</button></div>`;
        expect(detectWebsiteInterfaceLocale(document)).toBeNull();
        expect(resolveBrowserInterfaceLocale("auto", document, "zh-SG")).toBe("zh-CN");
    });

    it("persists valid manual preference and resets invalid stored values to auto", () => {
        expect(getInterfaceLocalePreference()).toBe("auto");

        setInterfaceLocalePreference("zh-TW");
        expect(getInterfaceLocalePreference()).toBe("zh-TW");
        expect(getUserscriptApiMocks().setValue).toHaveBeenCalledWith(INTERFACE_LOCALE_PREFERENCE_KEY, "zh-TW");

        getUserscriptApiMocks().values.set(INTERFACE_LOCALE_PREFERENCE_KEY, "invalid");
        expect(getInterfaceLocalePreference()).toBe("auto");
    });
});
