import { resolveBrowserInterfaceLocale } from "../adapters/browser-locale";
import { getInterfaceLocalePreference } from "../core/config";
import { translate, type InterfaceLocale, type LocaleKey, type LocaleMessageParams } from "../core/locale";

/**
 * 解析当前页面用于脚本界面的语言
 */
export function getCurrentInterfaceLocale(
    root: ParentNode = document,
    browserLanguage: string | undefined = navigator.language
): InterfaceLocale {
    return resolveBrowserInterfaceLocale(getInterfaceLocalePreference(), root, browserLanguage);
}

/**
 * 获取当前页面的脚本文案
 */
export function t(key: LocaleKey, params?: LocaleMessageParams): string {
    return translate(getCurrentInterfaceLocale(), key, params);
}
