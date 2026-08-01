import { describe, expect, it } from "vitest";
import { getChapterRetryReason, scanChapterIntegrity } from "../src/core/download/integrity";
import { createChapter, createDownloadTask } from "./support";

describe("getChapterRetryReason", () => {
    it("retries a missing chapter", () => {
        expect(getChapterRetryReason(undefined, true)).toBe("missing");
    });

    it("retries a chapter with failed images", () => {
        expect(getChapterRetryReason({ imageErrors: 2 }, true)).toBe("image-errors");
    });

    it("retries a legacy cached chapter with application/octet-stream images", () => {
        expect(
            getChapterRetryReason(
                {
                    imageErrors: 0,
                    images: [{ mediaType: "application/octet-stream" }]
                },
                true
            )
        ).toBe("invalid-image-media-type");
    });

    it("keeps a chapter whose images are normalized", () => {
        expect(
            getChapterRetryReason(
                {
                    imageErrors: 0,
                    images: [{ mediaType: "image/jpeg" }]
                },
                true
            )
        ).toBeNull();
    });

    it("ignores image state when image downloads are disabled", () => {
        expect(
            getChapterRetryReason(
                {
                    imageErrors: 1,
                    images: [{ mediaType: "application/octet-stream" }]
                },
                false
            )
        ).toBeNull();
    });

    it("scans chapter state in task order without copying chapter content", () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
        const completeChapter = createChapter(0);
        const chapters = new Map([
            [0, completeChapter],
            [2, createChapter(2, { imageErrors: 1 })]
        ]);

        expect(scanChapterIntegrity(tasks, chapters, true)).toEqual([
            { task: tasks[1], reason: "missing" },
            { task: tasks[2], reason: "image-errors" }
        ]);
        expect(chapters.get(0)).toBe(completeChapter);
    });
});
