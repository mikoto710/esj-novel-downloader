import { hasInvalidImageMediaTypes } from "../utils/image-format";

export type ChapterRetryReason = "missing" | "image-errors" | "invalid-image-media-type";

interface ChapterIntegrityData {
    images?: readonly { mediaType: string }[];
    imageErrors?: number;
}

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
