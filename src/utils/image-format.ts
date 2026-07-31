export type SupportedImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface DetectedImageFormat {
    extension: "jpg" | "png" | "gif" | "webp";
    mediaType: SupportedImageMediaType;
}

export interface NormalizedImage {
    blob: Blob;
    extension: DetectedImageFormat["extension"];
    mediaType: SupportedImageMediaType;
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];

function matches(bytes: Uint8Array, signature: number[], offset = 0): boolean {
    return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * Resolve an image source against the chapter page URL.
 * Protocol-relative URLs are resolved to the image host instead of the ESJZone origin.
 */
export function resolveImageUrl(src: string, baseUrl: string): string | null {
    try {
        const url = new URL(src, baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

/**
 * Detect the actual image format from its file signature instead of trusting HTTP Content-Type.
 */
export async function detectImageFormat(blob: Blob): Promise<DetectedImageFormat | null> {
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());

    if (matches(bytes, JPEG_SIGNATURE)) {
        return { extension: "jpg", mediaType: "image/jpeg" };
    }
    if (matches(bytes, PNG_SIGNATURE)) {
        return { extension: "png", mediaType: "image/png" };
    }
    if (matches(bytes, GIF87A_SIGNATURE) || matches(bytes, GIF89A_SIGNATURE)) {
        return { extension: "gif", mediaType: "image/gif" };
    }
    if (matches(bytes, RIFF_SIGNATURE) && matches(bytes, WEBP_SIGNATURE, 8)) {
        return { extension: "webp", mediaType: "image/webp" };
    }

    return null;
}

/**
 * Return a Blob whose MIME matches its detected image bytes.
 */
export async function normalizeImageBlob(blob: Blob): Promise<NormalizedImage | null> {
    const format = await detectImageFormat(blob);
    if (!format) {
        return null;
    }

    const declaredType = blob.type.split(";", 1)[0].trim().toLowerCase();
    const normalizedBlob = declaredType === format.mediaType ? blob : new Blob([blob], { type: format.mediaType });

    return {
        blob: normalizedBlob,
        extension: format.extension,
        mediaType: format.mediaType
    };
}

export function isSupportedImageMediaType(mediaType: string): mediaType is SupportedImageMediaType {
    return (
        mediaType === "image/jpeg" ||
        mediaType === "image/png" ||
        mediaType === "image/gif" ||
        mediaType === "image/webp"
    );
}
