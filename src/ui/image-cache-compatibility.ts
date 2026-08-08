import { evaluateImageCacheCompatibility } from "../core/cache/image-cache-compatibility";
import { t } from "./locale";

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
        return t("cache.compatible", { count: cachedCount });
    }
    if (compatibility === "unknown") {
        return t("cache.legacyImageUnknown", { count: cachedCount });
    }
    return t("cache.imageMismatch", { count: cachedCount });
}
