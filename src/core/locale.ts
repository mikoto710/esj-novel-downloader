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
 * 按优先级解析界面语言
 */
export function resolveInterfaceLocale(
    preference: InterfaceLocalePreference,
    websiteLocale: InterfaceLocale | null,
    browserLocale: InterfaceLocale
): InterfaceLocale {
    return preference === "auto" ? (websiteLocale ?? browserLocale) : preference;
}

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
    "common.minimize",
    "common.infoTitle",
    "common.warningTitle",
    "common.errorTitle",
    "common.viewDiagnostics",
    "common.preparing",
    "common.retry",
    "common.skip",
    "common.skipAll",
    "common.loading",
    "button.downloadAll",
    "button.settings",
    "settings.title",
    "settings.versionUnknown",
    "settings.concurrency",
    "settings.cache",
    "settings.history",
    "settings.diagnostics",
    "settings.diagnosticsButton",
    "settings.diagnosticsDescription",
    "settings.imageDownload",
    "settings.imageDownloadDescription",
    "settings.epubTagPage",
    "settings.epubTagPageDescription",
    "settings.relatedLinks",
    "settings.github",
    "settings.greasyFork",
    "settings.feedback",
    "settings.interfaceLanguage",
    "settings.interfaceLanguage.auto",
    "settings.interfaceLanguage.simplified",
    "settings.interfaceLanguage.traditional",
    "confirm.download.title",
    "confirm.download.cached",
    "confirm.download.empty",
    "confirm.imageSettings.title",
    "confirm.imageSettings.message",
    "confirm.imageSettings.continue",
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
    "common.minimize": "最小化",
    "common.infoTitle": "提示",
    "common.warningTitle": "请注意",
    "common.errorTitle": "操作失败",
    "common.viewDiagnostics": "查看诊断日志",
    "common.preparing": "准备中…",
    "common.retry": "重试",
    "common.skip": "跳过",
    "common.skipAll": "全部跳过",
    "common.loading": "加载中…",
    "button.downloadAll": "全本下载",
    "button.settings": "脚本设置",
    "settings.title": "脚本设置",
    "settings.versionUnknown": "版本未知",
    "settings.concurrency": "下载线程数（1-{max}）：",
    "settings.cache": "下载缓存",
    "settings.history": "下载记录",
    "settings.diagnostics": "诊断与反馈",
    "settings.diagnosticsButton": "诊断日志",
    "settings.diagnosticsDescription": "（用于导出问题排查信息）",
    "settings.imageDownload": "下载正文插图",
    "settings.imageDownloadDescription": "（会让速度变慢、体积变大）",
    "settings.epubTagPage": "生成 EPUB 标签页",
    "settings.epubTagPageDescription": "（关闭后标签仍会写入 EPUB 元数据）",
    "settings.relatedLinks": "相关链接",
    "settings.github": "GitHub 项目主页",
    "settings.greasyFork": "GreasyFork 脚本页",
    "settings.feedback": "反馈问题 / Issues",
    "settings.interfaceLanguage": "界面语言",
    "settings.interfaceLanguage.auto": "自动（跟随网站）",
    "settings.interfaceLanguage.simplified": "简体中文",
    "settings.interfaceLanguage.traditional": "繁體中文",
    "confirm.download.title": "✔️ 确认下载",
    "confirm.download.cached": "检测到已有 {count} 章缓存，点击确认将跳过已下载章节继续下载。",
    "confirm.download.empty": "是否开始抓取该小说全部章节？",
    "confirm.imageSettings.title": "⚠️ 切换插图设置",
    "confirm.imageSettings.message":
        "当前有 {count} 个全本任务正在下载。它们会继续使用启动时的插图设置，不受本次切换影响；本次更改仅对之后新启动的任务生效。",
    "confirm.imageSettings.continue": "继续切换",
    "download.progress": "进度：{completed}/{total}"
} satisfies Readonly<Record<LocaleKey, string>>);

/**
 * 繁體中文文案
 */
export const ZH_TW_MESSAGES = Object.freeze({
    "common.confirm": "確認",
    "common.cancel": "取消",
    "common.close": "關閉",
    "common.minimize": "最小化",
    "common.infoTitle": "提示",
    "common.warningTitle": "請注意",
    "common.errorTitle": "操作失敗",
    "common.viewDiagnostics": "查看診斷日誌",
    "common.preparing": "準備中…",
    "common.retry": "重試",
    "common.skip": "跳過",
    "common.skipAll": "全部跳過",
    "common.loading": "載入中…",
    "button.downloadAll": "全本下載",
    "button.settings": "腳本設定",
    "settings.title": "腳本設定",
    "settings.versionUnknown": "版本未知",
    "settings.concurrency": "下載執行緒數（1-{max}）：",
    "settings.cache": "下載快取",
    "settings.history": "下載記錄",
    "settings.diagnostics": "診斷與回饋",
    "settings.diagnosticsButton": "診斷日誌",
    "settings.diagnosticsDescription": "（用於匯出問題排查資訊）",
    "settings.imageDownload": "下載正文插圖",
    "settings.imageDownloadDescription": "（會讓速度變慢、體積變大）",
    "settings.epubTagPage": "產生 EPUB 標籤頁",
    "settings.epubTagPageDescription": "（關閉後標籤仍會寫入 EPUB 元資料）",
    "settings.relatedLinks": "相關連結",
    "settings.github": "GitHub 專案首頁",
    "settings.greasyFork": "GreasyFork 腳本頁",
    "settings.feedback": "回報問題 / Issues",
    "settings.interfaceLanguage": "介面語言",
    "settings.interfaceLanguage.auto": "自動（跟隨網站）",
    "settings.interfaceLanguage.simplified": "簡體中文",
    "settings.interfaceLanguage.traditional": "繁體中文",
    "confirm.download.title": "✔️ 確認下載",
    "confirm.download.cached": "偵測到已有 {count} 章快取，點擊確認將跳過已下載章節繼續下載。",
    "confirm.download.empty": "是否開始抓取此小說全部章節？",
    "confirm.imageSettings.title": "⚠️ 切換插圖設定",
    "confirm.imageSettings.message":
        "目前有 {count} 個全本任務正在下載。它們會繼續使用啟動時的插圖設定，不受本次切換影響；本次變更僅對之後新啟動的任務生效。",
    "confirm.imageSettings.continue": "繼續切換",
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
