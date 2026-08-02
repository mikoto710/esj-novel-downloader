import { evaluateImageCacheCompatibility } from "../core/cache/image-cache-compatibility";

/**
 * 根据任务启动时的插图设置说明本次缓存恢复行为
 */
export function getImageCacheConfirmHint(
    cachedCount: number,
    cachedImageEnabled: boolean | undefined,
    requestedImageEnabled: boolean
): string | undefined {
    if (cachedCount === 0) {
        return undefined;
    }

    const compatibility = evaluateImageCacheCompatibility(cachedImageEnabled, requestedImageEnabled);
    if (compatibility === "compatible") {
        return `检测到已有 ${cachedCount} 章兼容缓存，点击确定将跳过已下载章节继续下载。`;
    }
    if (compatibility === "unknown") {
        return `检测到 ${cachedCount} 章旧缓存，但缺少插图设置信息。点击确定后将安全失效旧章节并重新抓取。`;
    }
    return `检测到 ${cachedCount} 章缓存，但插图设置与本次任务不同。点击确定后将安全失效旧章节并重新抓取。`;
}
