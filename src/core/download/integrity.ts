import { hasInvalidImageMediaTypes } from "../../utils/image-format";

/**
 * 章节需要补抓的原因
 */
export type ChapterRetryReason = "missing" | "image-errors" | "invalid-image-media-type";

// 只依赖完整性检查所需字段，避免把 Chapter 的存储结构固化到判定函数中
interface ChapterIntegrityData {
    images?: readonly { mediaType: string }[];
    imageErrors?: number;
}

/**
 * 判断章节是否需要补抓
 * 关闭图片下载时只要求章节存在，不检查图片错误和媒体类型
 */
export function getChapterRetryReason(
    chapter: ChapterIntegrityData | undefined,
    imageDownloadEnabled: boolean
): ChapterRetryReason | null {
    if (!chapter) {
        return "missing";
    }
    if (!imageDownloadEnabled) {
        return null;
    }
    if ((chapter.imageErrors ?? 0) > 0) {
        return "image-errors";
    }
    if (hasInvalidImageMediaTypes(chapter.images)) {
        return "invalid-image-media-type";
    }
    return null;
}
