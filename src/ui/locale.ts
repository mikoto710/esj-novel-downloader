import { resolveBrowserInterfaceLocale } from "../adapters/browser-locale";
import { getInterfaceLocalePreference } from "../core/config";
import { translate, type InterfaceLocale, type LocaleKey, type LocaleMessageParams } from "../core/locale";

type InterfaceLocaleListener = (locale: InterfaceLocale) => void;

const localeListeners = new Set<InterfaceLocaleListener>();
let runtimeLocaleObserver: MutationObserver | null = null;
let lastPublishedLocale: InterfaceLocale | null = null;

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

function serializeParams(params?: LocaleMessageParams): string {
    return params ? JSON.stringify(params) : "";
}

function parseParams(value: string | undefined): LocaleMessageParams | undefined {
    if (!value) {
        return undefined;
    }
    try {
        return JSON.parse(value) as LocaleMessageParams;
    } catch {
        return undefined;
    }
}

/**
 * 标记文本元素并保存其文案键，供运行时切换语言
 */
export function bindInterfaceText(element: HTMLElement, key: LocaleKey, params?: LocaleMessageParams): HTMLElement {
    element.dataset.esjI18nText = key;
    element.dataset.esjI18nParams = serializeParams(params);
    element.textContent = t(key, params);
    return element;
}

/**
 * 标记需要在运行时切换语言的提示或可访问属性
 */
export function bindInterfaceAttribute(
    element: HTMLElement,
    attribute: "title" | "aria-label",
    key: LocaleKey,
    params?: LocaleMessageParams
): HTMLElement {
    const suffix = attribute === "title" ? "Title" : "AriaLabel";
    element.dataset[`esjI18n${suffix}`] = key;
    element.dataset[`esjI18n${suffix}Params`] = serializeParams(params);
    element.setAttribute(attribute, t(key, params));
    return element;
}

/**
 * 原地刷新已绑定的界面文本、title 和 aria-label 属性
 */
export function refreshBoundInterfaceText(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>("[data-esj-i18n-text]").forEach((element) => {
        element.textContent = t(element.dataset.esjI18nText as LocaleKey, parseParams(element.dataset.esjI18nParams));
    });
    (
        [
            ["title", "esjI18nTitle", "esjI18nTitleParams"],
            ["aria-label", "esjI18nAriaLabel", "esjI18nAriaLabelParams"]
        ] as const
    ).forEach(([attribute, keyField, paramsField]) => {
        root.querySelectorAll<HTMLElement>(
            `[data-${keyField.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`
        ).forEach((element) => {
            element.setAttribute(
                attribute,
                t(element.dataset[keyField] as LocaleKey, parseParams(element.dataset[paramsField]))
            );
        });
    });
}

export function subscribeInterfaceLocaleChange(listener: InterfaceLocaleListener): () => void {
    localeListeners.add(listener);
    return () => localeListeners.delete(listener);
}

export function publishInterfaceLocaleChange(): void {
    const locale = getCurrentInterfaceLocale();
    lastPublishedLocale = locale;
    refreshBoundInterfaceText();
    localeListeners.forEach((listener) => listener(locale));
}

/**
 * 监听网站原文与简繁转换状态，不介入正文转换过程
 */
export function installRuntimeInterfaceLocaleSync(root: HTMLElement = document.documentElement): () => void {
    runtimeLocaleObserver?.disconnect();
    lastPublishedLocale = getCurrentInterfaceLocale();
    let scheduled = false;
    const publishIfChanged = () => {
        scheduled = false;
        const locale = getCurrentInterfaceLocale();
        if (locale !== lastPublishedLocale) {
            publishInterfaceLocaleChange();
        }
    };
    runtimeLocaleObserver = new MutationObserver(() => {
        if (!scheduled) {
            scheduled = true;
            queueMicrotask(publishIfChanged);
        }
    });
    runtimeLocaleObserver.observe(root, {
        attributes: true,
        attributeFilter: ["class", "data-encode"],
        childList: true,
        subtree: true
    });
    return () => {
        runtimeLocaleObserver?.disconnect();
        runtimeLocaleObserver = null;
    };
}
