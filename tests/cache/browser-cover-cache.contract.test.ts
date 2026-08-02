// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { BookCover } from "../../src/types";
import { createChapter } from "../support";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

function createJpegCover(declaredType = "image/jpeg"): BookCover {
    const bytes = new Uint8Array(1_200);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    return {
        blob: new Blob([bytes], { type: declaredType }),
        ext: "jpg",
        mediaType: "image/jpeg"
    };
}

describe("browser cover cache contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
    });

    it("reuses a cached cover when every chapter is already restored", async () => {
        const tasks = createBrowserDownloadTasks(2);
        const options = { ...createBrowserDownloadOptions(tasks), coverUrl: "https://img.example/cover.jpg" };
        runtime.state.globalChaptersMap = new Map(tasks.map((task) => [task.index, createChapter(task.index)]));
        mocks.loadCoverCache.mockResolvedValue(createJpegCover());

        await runtime.batchDownload(options);

        expect(mocks.loadCoverCache).toHaveBeenCalledWith("100", options.coverUrl);
        expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
        expect(mocks.saveCoverCache).not.toHaveBeenCalled();
        expect(runtime.state.cachedData?.metadata.coverExt).toBe("jpg");
        expect(mocks.log).toHaveBeenCalledWith("💾 已读取本地封面缓存");
    });

    it("downloads, normalizes, and stores a cache miss", async () => {
        const tasks = createBrowserDownloadTasks(1);
        const options = { ...createBrowserDownloadOptions(tasks), coverUrl: "https://img.example/cover.jpg" };
        runtime.state.globalChaptersMap = new Map([[0, createChapter(0)]]);
        const networkBlob = createJpegCover("application/octet-stream").blob;
        mocks.fetchWithTimeout.mockResolvedValue({ blob: async () => networkBlob });

        await runtime.batchDownload(options);

        expect(mocks.fetchWithTimeout).toHaveBeenCalledOnce();
        expect(mocks.saveCoverCache).toHaveBeenCalledWith(
            "100",
            "task-100",
            options.coverUrl,
            expect.objectContaining({ ext: "jpg", mediaType: "image/jpeg" }),
            expect.any(AbortSignal)
        );
        const savedCover = mocks.saveCoverCache.mock.calls[0][3] as BookCover;
        expect(savedCover.blob.type).toBe("image/jpeg");
        expect(runtime.state.cachedData?.metadata.coverBlob?.type).toBe("image/jpeg");
    });

    it("uses the PNG signature instead of the declared network MIME", async () => {
        const tasks = createBrowserDownloadTasks(1);
        const options = { ...createBrowserDownloadOptions(tasks), coverUrl: "https://img.example/cover.bin" };
        runtime.state.globalChaptersMap = new Map([[0, createChapter(0)]]);
        const bytes = new Uint8Array(1_200);
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        mocks.fetchWithTimeout.mockResolvedValue({
            blob: async () => new Blob([bytes], { type: "application/octet-stream" })
        });

        await runtime.batchDownload(options);

        expect(mocks.saveCoverCache).toHaveBeenCalledWith(
            "100",
            "task-100",
            options.coverUrl,
            expect.objectContaining({ ext: "png", mediaType: "image/png" }),
            expect.any(AbortSignal)
        );
        expect(runtime.state.cachedData?.metadata.coverExt).toBe("png");
        expect(runtime.state.cachedData?.metadata.coverBlob?.type).toBe("image/png");
    });

    it("keeps the in-memory cover when its optional cache write fails", async () => {
        const tasks = createBrowserDownloadTasks(1);
        const options = { ...createBrowserDownloadOptions(tasks), coverUrl: "https://img.example/cover.jpg" };
        runtime.state.globalChaptersMap = new Map([[0, createChapter(0)]]);
        mocks.fetchWithTimeout.mockResolvedValue({ blob: async () => createJpegCover().blob });
        mocks.saveCoverCache.mockRejectedValue(new Error("cover cache unavailable"));

        await expect(runtime.batchDownload(options)).resolves.toBeUndefined();

        expect(runtime.state.cachedData?.metadata.coverBlob).not.toBeNull();
        expect(mocks.showFormatChoice).toHaveBeenCalledOnce();
        expect(mocks.log).toHaveBeenCalledWith(expect.stringContaining("本次继续使用内存封面"));
    });

    it("does not cache an invalid or undersized network response", async () => {
        const tasks = createBrowserDownloadTasks(1);
        const options = { ...createBrowserDownloadOptions(tasks), coverUrl: "https://img.example/cover.jpg" };
        runtime.state.globalChaptersMap = new Map([[0, createChapter(0)]]);
        mocks.fetchWithTimeout.mockResolvedValue({
            blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })
        });

        await runtime.batchDownload(options);

        expect(mocks.saveCoverCache).not.toHaveBeenCalled();
        expect(runtime.state.cachedData?.metadata.coverBlob).toBeNull();
    });
});
