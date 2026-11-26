import { describe, expect, it } from "vitest";
import { resolveImageUrl } from "../../src/site/images";
import { detectImageFormat } from "../../src/content/image-format";

describe("resolveImageUrl", () => {
    const chapterUrl = "https://www.esjzone.cc/forum/1/2.html";

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
});
