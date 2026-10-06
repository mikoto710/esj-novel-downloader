import type { InterfaceLocale } from "../locale/catalog";

export const WEBSITE_LOCALE_SWITCH_SELECTOR = ".customizer-text-switch .trans.active[data-encode]";

/**
 * 读取网站正文转换状态
 */
export function detectWebsiteInterfaceLocale(root: ParentNode): InterfaceLocale | null {
    const activeSwitch = root.querySelector(WEBSITE_LOCALE_SWITCH_SELECTOR);
    const encoding = activeSwitch?.getAttribute("data-encode")?.trim();
    if (encoding === "1") {
        return "zh-CN";
    }
    if (encoding === "0" || encoding === "2") {
        return "zh-TW";
    }
    return null;
}
