/**
 * 正文插图设置与已有章节缓存之间的兼容结果
 */
export type ImageCacheCompatibility = "compatible" | "refetch-required" | "unknown";

/**
 * 仅在缓存明确记录了与新任务相同的插图设置时复用章节
 */
export function evaluateImageCacheCompatibility(
    cachedImageEnabled: boolean | undefined,
    requestedImageEnabled: boolean
): ImageCacheCompatibility {
    if (cachedImageEnabled === undefined) {
        return "unknown";
    }
    return cachedImageEnabled === requestedImageEnabled ? "compatible" : "refetch-required";
}
