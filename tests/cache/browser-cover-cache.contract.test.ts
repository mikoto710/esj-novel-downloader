// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { BookCover } from "../../src/content/model";
import { createChapter } from "../support";
import {
    type BrowserDownloadRuntime,
    createBrowserDownloadOptions,
    createBrowserDownloadTasks,
    getBrowserDownloadMocks,
    expectReadyDownload,
    resetBrowserDownloadHarness
} from "../support/browser-download-harness";

const mocks = getBrowserDownloadMocks();
let runtime: BrowserDownloadRuntime;

function createJpegCover(): BookCover {
    const bytes = new Uint8Array(1_200);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    return {
        blob: new Blob([bytes], { type: "image/jpeg" }),
        ext: "jpg",
        mediaType: "image/jpeg"
    };
}

describe("browser cover cache contracts", () => {
    beforeEach(async () => {
        runtime = await resetBrowserDownloadHarness();
    });

    it("keeps the in-memory cover when its optional cache write fails", async () => {
        const tasks = createBrowserDownloadTasks(1);
        const options = { ...createBrowserDownloadOptions(tasks), coverUrl: "https://img.example/cover.jpg" };
        runtime.task.chapters = new Map([[0, createChapter(0)]]);
        mocks.fetchWithTimeout.mockResolvedValue({ blob: async () => createJpegCover().blob });
        mocks.saveCoverCache.mockRejectedValue(new Error("cover cache unavailable"));

        const data = expectReadyDownload(await runtime.runBookDownload(options));

        expect(data.metadata.coverBlob).not.toBeNull();
    });

    it("does not cache an undersized network response", async () => {
        const tasks = createBrowserDownloadTasks(1);
        const options = { ...createBrowserDownloadOptions(tasks), coverUrl: "https://img.example/cover.jpg" };
        runtime.task.chapters = new Map([[0, createChapter(0)]]);
        mocks.fetchWithTimeout.mockResolvedValue({
            blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })
        });

        const data = expectReadyDownload(await runtime.runBookDownload(options));

        expect(mocks.saveCoverCache).not.toHaveBeenCalled();
        expect(data.metadata.coverBlob).toBeNull();
    });
});
