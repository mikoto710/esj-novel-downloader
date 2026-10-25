import { ZH_CN_MESSAGES } from "./locales/zh-CN";
import { ZH_TW_MESSAGES } from "./locales/zh-TW";

export { ZH_CN_MESSAGES, ZH_TW_MESSAGES };

/**
 * 脚本界面语言
 */
export type InterfaceLocale = "zh-CN" | "zh-TW";

export const INTERFACE_LOCALE_PREFERENCES = ["auto", "zh-CN", "zh-TW"] as const;

export type InterfaceLocalePreference = (typeof INTERFACE_LOCALE_PREFERENCES)[number];

/**
 * 检查界面语言偏好是否有效
 */
export function isInterfaceLocalePreference(value: unknown): value is InterfaceLocalePreference {
    return INTERFACE_LOCALE_PREFERENCES.some((preference) => preference === value);
}

/**
 * 显式语言偏好优先，自动模式依次采用站点提示和浏览器语言
 */
export function resolveInterfaceLocale(
    preference: InterfaceLocalePreference,
    websiteLocale: InterfaceLocale | null,
    browserLocale: InterfaceLocale
): InterfaceLocale {
    return preference === "auto" ? (websiteLocale ?? browserLocale) : preference;
}

/**
 * 将 zh-CN 与 zh-SG 映射为简体界面，其余或缺失语言回退为繁体
 */
export function detectBrowserInterfaceLocale(language: string | undefined): InterfaceLocale {
    const normalized = language?.trim().toLowerCase().replace("_", "-");
    if (normalized === "zh-cn" || normalized === "zh-sg") {
        return "zh-CN";
    }
    return "zh-TW";
}

export type LocaleMessageValue = string | number | boolean;

export type LocaleMessageParams = Readonly<Record<string, LocaleMessageValue>>;

export type LocaleCatalog = Readonly<Record<string, string>>;

export type LocaleCatalogs = Readonly<Record<InterfaceLocale, LocaleCatalog>>;

/** 键由基础字典推导，繁体字典在声明处检查同一组键。 */
export type LocaleKey = keyof typeof ZH_CN_MESSAGES;

export const LOCALE_KEYS: readonly LocaleKey[] = Object.freeze(Object.keys(ZH_CN_MESSAGES) as LocaleKey[]);

export const LOCALE_CATALOGS: LocaleCatalogs = Object.freeze({
    "zh-CN": ZH_CN_MESSAGES,
    "zh-TW": ZH_TW_MESSAGES
});

const LOCALE_PARAMETER_PATTERN = /\{([A-Za-z][A-Za-z0-9_.-]*)\}/g;

export class MissingLocaleMessageError extends Error {
    readonly locale: InterfaceLocale;
    readonly key: string;

    constructor(locale: InterfaceLocale, key: string) {
        super(`Missing locale message: ${locale}.${key}`);
        this.name = "MissingLocaleMessageError";
        this.locale = locale;
        this.key = key;
    }
}

export class MissingLocaleParameterError extends Error {
    readonly key: string;
    readonly parameter: string;

    constructor(key: string, parameter: string) {
        super(`Missing locale message parameter: ${key}.{${parameter}}`);
        this.name = "MissingLocaleParameterError";
        this.key = key;
        this.parameter = parameter;
    }
}

export class IncompleteLocaleCatalogError extends Error {
    readonly missing: Readonly<Record<InterfaceLocale, readonly string[]>>;

    constructor(missing: Readonly<Record<InterfaceLocale, readonly string[]>>) {
        const details = (Object.entries(missing) as Array<[InterfaceLocale, readonly string[]]>)
            .filter(([, keys]) => keys.length > 0)
            .map(([locale, keys]) => `${locale}: ${keys.join(", ")}`)
            .join("; ");
        super(`Incomplete locale catalog: ${details}`);
        this.name = "IncompleteLocaleCatalogError";
        this.missing = missing;
    }
}

/**
 * 检查字典缺失的稳定键
 */
export function findMissingLocaleKeys(
    catalogs: LocaleCatalogs,
    expectedKeys: readonly string[] = LOCALE_KEYS
): Readonly<Record<InterfaceLocale, readonly string[]>> {
    return {
        "zh-CN": expectedKeys.filter((key) => !(key in catalogs["zh-CN"])),
        "zh-TW": expectedKeys.filter((key) => !(key in catalogs["zh-TW"]))
    };
}

/**
 * 断言字典包含完整稳定键
 */
export function assertLocaleCatalogsComplete(
    catalogs: LocaleCatalogs = LOCALE_CATALOGS,
    expectedKeys: readonly string[] = LOCALE_KEYS
): void {
    const missing = findMissingLocaleKeys(catalogs, expectedKeys);
    if (missing["zh-CN"].length > 0 || missing["zh-TW"].length > 0) {
        throw new IncompleteLocaleCatalogError(missing);
    }
}

/**
 * 替换文案占位参数，缺少对应参数时抛出 MissingLocaleParameterError
 */
export function interpolateLocaleMessage(key: string, template: string, params: LocaleMessageParams = {}): string {
    return template.replace(LOCALE_PARAMETER_PATTERN, (_placeholder, parameter: string) => {
        if (!Object.prototype.hasOwnProperty.call(params, parameter)) {
            throw new MissingLocaleParameterError(key, parameter);
        }
        return String(params[parameter]);
    });
}

/**
 * 读取指定语言的文案并插值，缺少键或参数时抛出对应错误
 */
export function translate(locale: InterfaceLocale, key: LocaleKey, params?: LocaleMessageParams): string {
    const message = LOCALE_CATALOGS[locale][key];
    if (message === undefined) {
        throw new MissingLocaleMessageError(locale, key);
    }
    return interpolateLocaleMessage(key, message, params);
}
