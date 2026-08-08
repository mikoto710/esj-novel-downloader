import { isInterfaceLocalePreference, type InterfaceLocalePreference } from "./locale";

// 默认配置
const DEFAULT_CONFIG = {
    concurrency: 5,
    enableImageDownload: false,
    enableEpubTagPage: false
};

export const INTERFACE_LOCALE_PREFERENCE_KEY = "interface_locale_preference";
const DEFAULT_INTERFACE_LOCALE_PREFERENCE: InterfaceLocalePreference = "auto";

/**
 * 获取并发数
 */
export function getConcurrency(): number {
    // 从 Tampermonkey 存储中读取
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
    const stored = GM_getValue<unknown>(INTERFACE_LOCALE_PREFERENCE_KEY, DEFAULT_INTERFACE_LOCALE_PREFERENCE);
    return isInterfaceLocalePreference(stored) ? stored : DEFAULT_INTERFACE_LOCALE_PREFERENCE;
}

/**
 * 保存界面语言偏好
 */
export function setInterfaceLocalePreference(preference: InterfaceLocalePreference): void {
    GM_setValue(INTERFACE_LOCALE_PREFERENCE_KEY, preference);
}
