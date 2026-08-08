import { resolveInterfaceLocale, type InterfaceLocale, type InterfaceLocalePreference } from "../core/locale";

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

/**
 * 映射浏览器语言
 */
export function detectBrowserInterfaceLocale(language: string | undefined): InterfaceLocale {
    const normalized = language?.trim().toLowerCase().replace("_", "-");
    if (normalized === "zh-cn" || normalized === "zh-sg") {
        return "zh-CN";
    }
    return "zh-TW";
}

/**
 * 按用户偏好、网站转换状态、浏览器语言的顺序解析脚本界面语言
 */
export function resolveBrowserInterfaceLocale(
    preference: InterfaceLocalePreference,
    root: ParentNode,
    browserLanguage: string | undefined
): InterfaceLocale {
    return resolveInterfaceLocale(
        preference,
        detectWebsiteInterfaceLocale(root),
        detectBrowserInterfaceLocale(browserLanguage)
    );
}
