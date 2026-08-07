/**
 * 脚本界面语言
 */
export type InterfaceLocale = "zh-CN" | "zh-TW";

export type LocaleMessageValue = string | number | boolean;
export type LocaleMessageParams = Readonly<Record<string, LocaleMessageValue>>;
export type LocaleCatalog = Readonly<Record<string, string>>;
export type LocaleCatalogs = Readonly<Record<InterfaceLocale, LocaleCatalog>>;

/**
 * 基础文案键，后续迁移按需扩充
 */
export const LOCALE_KEYS = [
    "common.confirm",
    "common.cancel",
    "common.close",
    "common.retry",
    "common.skip",
    "common.skipAll",
    "common.loading",
    "settings.interfaceLanguage",
    "settings.interfaceLanguage.auto",
    "settings.interfaceLanguage.simplified",
    "settings.interfaceLanguage.traditional",
    "download.progress"
] as const;

export type LocaleKey = (typeof LOCALE_KEYS)[number];

/**
 * 简体中文文案
 */
export const ZH_CN_MESSAGES = Object.freeze({
    "common.confirm": "确认",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.retry": "重试",
    "common.skip": "跳过",
    "common.skipAll": "全部跳过",
    "common.loading": "加载中…",
    "settings.interfaceLanguage": "界面语言",
    "settings.interfaceLanguage.auto": "自动（跟随网站）",
    "settings.interfaceLanguage.simplified": "简体中文",
    "settings.interfaceLanguage.traditional": "繁體中文",
    "download.progress": "进度：{completed}/{total}"
} satisfies Readonly<Record<LocaleKey, string>>);

/**
 * 繁體中文文案
 */
export const ZH_TW_MESSAGES = Object.freeze({
    "common.confirm": "確認",
    "common.cancel": "取消",
    "common.close": "關閉",
    "common.retry": "重試",
    "common.skip": "跳過",
    "common.skipAll": "全部跳過",
    "common.loading": "載入中…",
    "settings.interfaceLanguage": "介面語言",
    "settings.interfaceLanguage.auto": "自動（跟隨網站）",
    "settings.interfaceLanguage.simplified": "簡體中文",
    "settings.interfaceLanguage.traditional": "繁體中文",
    "download.progress": "進度：{completed}/{total}"
} satisfies Readonly<Record<LocaleKey, string>>);

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
 * 替换文案参数
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
 * 生成指定语言的文案
 */
export function translate(locale: InterfaceLocale, key: LocaleKey, params?: LocaleMessageParams): string {
    const message = LOCALE_CATALOGS[locale][key];
    if (message === undefined) {
        throw new MissingLocaleMessageError(locale, key);
    }
    return interpolateLocaleMessage(key, message, params);
}
