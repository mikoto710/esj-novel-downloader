import { isInterfaceLocalePreference, type InterfaceLocalePreference } from "../locale/catalog";

// 默认配置
const DEFAULT_CONFIG = {
    concurrency: 5,
    enableImageDownload: false,
    enableEpubTagPage: false
};

export const INTERFACE_LOCALE_PREFERENCE_KEY = "interface_locale_preference";
const DEFAULT_INTERFACE_LOCALE_PREFERENCE: InterfaceLocalePreference = "auto";
const CHAPTER_REQUEST_MODE_KEY = "chapter_request_mode";

type ChapterRequestMode = "gm" | "fetch";

/**
 * 获取并发数
 */
export function getConcurrency(): number {
    let val = GM_getValue("concurrency", DEFAULT_CONFIG.concurrency);

    if (typeof val !== "number" || val <= 0) {
        val = DEFAULT_CONFIG.concurrency;
    }
    return val;
}

/**
 * 保存并发数
 */
export function setConcurrency(num: number): void {
    if (num > 10) {
        num = 10;
    }
    if (num < 1) {
        num = 1;
    }
    GM_setValue("concurrency", num);
}

/**
 * 读取批量章节请求方式，旧安装默认使用 GM
 */
export function getChapterRequestMode(): ChapterRequestMode {
    return GM_getValue<unknown>(CHAPTER_REQUEST_MODE_KEY, "gm") === "fetch" ? "fetch" : "gm";
}

/**
 * 保存后续批量下载使用的章节请求方式
 */
export function setChapterRequestMode(mode: ChapterRequestMode): void {
    GM_setValue(CHAPTER_REQUEST_MODE_KEY, mode);
}

/**
 * 获取图片下载设置
 */
export function getImageDownloadSetting(): boolean {
    return GM_getValue("enable_image_download", DEFAULT_CONFIG.enableImageDownload);
}

/**
 * 设置是否进行图片下载
 */
export function setImageDownloadSetting(val: boolean): void {
    GM_setValue("enable_image_download", val);
}

/**
 * 获取 EPUB 标签页设置
 */
export function getEpubTagPageSetting(): boolean {
    return GM_getValue("enable_epub_tag_page", DEFAULT_CONFIG.enableEpubTagPage);
}

/**
 * 设置是否生成 EPUB 标签页
 */
export function setEpubTagPageSetting(val: boolean): void {
    GM_setValue("enable_epub_tag_page", val);
}

/**
 * 读取界面语言偏好
 */
export function getInterfaceLocalePreference(): InterfaceLocalePreference {
    try {
        const stored = GM_getValue<unknown>(INTERFACE_LOCALE_PREFERENCE_KEY, DEFAULT_INTERFACE_LOCALE_PREFERENCE);
        return isInterfaceLocalePreference(stored) ? stored : DEFAULT_INTERFACE_LOCALE_PREFERENCE;
    } catch {
        // 语言偏好不可用时跟随页面语言，不能让界面文案阻断任务和资源释放
        return DEFAULT_INTERFACE_LOCALE_PREFERENCE;
    }
}

/**
 * 保存界面语言偏好
 */
export function setInterfaceLocalePreference(preference: InterfaceLocalePreference): void {
    GM_setValue(INTERFACE_LOCALE_PREFERENCE_KEY, preference);
}
