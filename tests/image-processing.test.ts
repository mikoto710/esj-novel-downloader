// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWithTimeoutMock, logMock, sleepWithAbortMock } = vi.hoisted(() => ({
    fetchWithTimeoutMock: vi.fn(),
    logMock: vi.fn(),
    sleepWithAbortMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../src/utils/index", () => ({
    fetchWithTimeout: fetchWithTimeoutMock,
    log: logMock,
    sleepWithAbort: sleepWithAbortMock
}));

import { processHtmlImages } from "../src/utils/image";

function blobResponse(blob: Blob): Response {
    return { blob: vi.fn().mockResolvedValue(blob) } as unknown as Response;
}

describe("processHtmlImages", () => {
    beforeEach(() => {
        fetchWithTimeoutMock.mockReset();
        logMock.mockReset();
        sleepWithAbortMock.mockClear();
    });

    it("downloads a protocol-relative ori.file URL and normalizes its MIME", async () => {
        const jpegBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {
            type: "application/octet-stream"
        });
        fetchWithTimeoutMock.mockResolvedValue(blobResponse(jpegBlob));

        const result = await processHtmlImages(
            '<p><img src="//images.novelpia.com/imagebox/example_ori.file" alt="插图"></p>',
            2
        );

        expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
            "https://images.novelpia.com/imagebox/example_ori.file",
            expect.objectContaining({ method: "GET", credentials: "omit" }),
            20_000,
            undefined
        );
        expect(result.failCount).toBe(0);
        expect(result.images).toHaveLength(1);
        expect(result.images[0]).toMatchObject({ id: "img_2_0.jpg", mediaType: "image/jpeg" });
        expect(result.images[0].blob.type).toBe("image/jpeg");
        expect(result.processedHtml).toContain('src="img_2_0.jpg"');
    });

    it("rejects a successful HTML response instead of embedding it as an image", async () => {
        const htmlBlob = new Blob(["<!doctype html><html></html>"], { type: "text/html" });
        fetchWithTimeoutMock.mockResolvedValue(blobResponse(htmlBlob));

        const result = await processHtmlImages('<img src="https://example.com/image.file" alt="插图">', 0);

        expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(3);
        expect(result.images).toEqual([]);
        expect(result.failCount).toBe(1);
        expect(result.processedHtml).toContain("图片加载失败");
    });

    it("keeps a normalized original when Canvas compression cannot decode it", async () => {
        const bytes = new Uint8Array(100 * 1024 + 1);
        bytes.set([0xff, 0xd8, 0xff, 0xe0]);
        const jpegBlob = new Blob([bytes], { type: "application/octet-stream" });
        fetchWithTimeoutMock.mockResolvedValue(blobResponse(jpegBlob));

        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

        class FailingImage {
            width = 0;
            height = 0;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            set src(_value: string) {
                queueMicrotask(() => this.onerror?.());
            }
        }

        vi.stubGlobal("Image", FailingImage);

        const result = await processHtmlImages('<img src="https://example.com/large.file">', 1);

        expect(result.failCount).toBe(0);
        expect(result.images[0]).toMatchObject({ id: "img_1_0.jpg", mediaType: "image/jpeg" });
        expect(result.images[0].blob.type).toBe("image/jpeg");
        expect(result.images[0].blob.size).toBe(jpegBlob.size);
    });
});
