import { describe, expect, it } from "vitest";
import {
    detectImageFormat,
    hasInvalidImageMediaTypes,
    isSupportedImageMediaType,
    normalizeImageBlob,
    resolveImageUrl
} from "../src/utils/image-format";

describe("resolveImageUrl", () => {
    const chapterUrl = "https://www.esjzone.cc/forum/1/2.html";

    it("resolves protocol-relative image URLs to the image host", () => {
        expect(resolveImageUrl("//images.novelpia.com/imagebox/example_ori.file", chapterUrl)).toBe(
            "https://images.novelpia.com/imagebox/example_ori.file"
        );
    });

    it("resolves root-relative image URLs to the chapter origin", () => {
        expect(resolveImageUrl("/images/example.jpg", chapterUrl)).toBe("https://www.esjzone.cc/images/example.jpg");
    });

    it("rejects non-HTTP image sources", () => {
        expect(resolveImageUrl("data:image/png;base64,AAAA", chapterUrl)).toBeNull();
    });
});

describe("detectImageFormat", () => {
    it.each([
        {
            name: "JPEG",
            bytes: [0xff, 0xd8, 0xff, 0xe0],
            expected: { extension: "jpg", mediaType: "image/jpeg" }
        },
        {
            name: "PNG",
            bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            expected: { extension: "png", mediaType: "image/png" }
        },
        {
            name: "GIF",
            bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
            expected: { extension: "gif", mediaType: "image/gif" }
        },
        {
            name: "WebP",
            bytes: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
            expected: { extension: "webp", mediaType: "image/webp" }
        }
    ])("detects $name from its file signature", async ({ bytes, expected }) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
        await expect(detectImageFormat(blob)).resolves.toEqual(expected);
    });

    it("rejects HTML returned with a successful HTTP response", async () => {
        const blob = new Blob(["<!doctype html><html></html>"], { type: "text/html" });
        await expect(detectImageFormat(blob)).resolves.toBeNull();
    });
});

describe("normalizeImageBlob", () => {
    it("replaces application/octet-stream with the detected image MIME", async () => {
        const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {
            type: "application/octet-stream"
        });

        const normalized = await normalizeImageBlob(blob);

        expect(normalized?.extension).toBe("jpg");
        expect(normalized?.mediaType).toBe("image/jpeg");
        expect(normalized?.blob.type).toBe("image/jpeg");
        expect(normalized?.blob.size).toBe(blob.size);
    });

    it("keeps a correctly typed image Blob", async () => {
        const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
        const normalized = await normalizeImageBlob(blob);
        expect(normalized?.blob).toBe(blob);
    });
});

describe("isSupportedImageMediaType", () => {
    it("accepts EPUB-compatible image media types", () => {
        expect(isSupportedImageMediaType("image/jpeg")).toBe(true);
        expect(isSupportedImageMediaType("image/png")).toBe(true);
    });

    it("rejects generic binary media types", () => {
        expect(isSupportedImageMediaType("application/octet-stream")).toBe(false);
    });
});

describe("hasInvalidImageMediaTypes", () => {
    it("flags legacy cached images with a generic binary MIME", () => {
        expect(hasInvalidImageMediaTypes([{ mediaType: "application/octet-stream" }])).toBe(true);
    });

    it("accepts an empty or fully normalized image list", () => {
        expect(hasInvalidImageMediaTypes(undefined)).toBe(false);
        expect(hasInvalidImageMediaTypes([{ mediaType: "image/jpeg" }])).toBe(false);
    });
});
