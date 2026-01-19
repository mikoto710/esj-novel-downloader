import { log } from "../utils/index";

// 默认配置
const DEFAULT_CONFIG = {
    concurrency: 5,
    enableImageDownload: false
};

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
    log(`并发数已更新为: ${num}`);
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
