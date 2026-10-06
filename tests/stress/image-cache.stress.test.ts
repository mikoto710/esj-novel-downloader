import { describe, expect, it } from "vitest";
import type { ChapterImage } from "../../src/content/model";
import { createChapter, createChapterImage, createDownloadTask } from "../support";
import { createStressDownloadHarness, createStressDownloadOptions } from "./download-stress-harness";

describe("image cache pressure", () => {
    it("batches large image blobs within the payload byte budget", async () => {
        const tasks = Array.from({ length: 12 }, (_, index) => createDownloadTask(index));
        const blobBytes = 1024 * 1024;
        const harness = createStressDownloadHarness({
            tasks,
            imageEnabled: true,
            processChapter: (task) => {
                const bytes = new Uint8Array(blobBytes);
                bytes.set([0xff, 0xd8, 0xff, 0xe0]);
                return createChapter(task.index, {
                    images: [
                        createChapterImage(task.index, {
                            blob: new Blob([bytes], { type: "image/jpeg" })
                        })
                    ]
                });
            }
        });

        await harness.run(createStressDownloadOptions(tasks, true));

        expect(
            harness.persistedBatches.every((batch) => batch.length > 0 && batch.length * blobBytes <= 4 * blobBytes)
        ).toBe(true);
        expect(harness.persistedIndexes.toSorted((left, right) => left - right)).toEqual(
            tasks.map((task) => task.index)
        );
        expect(harness.exportData?.chapters).toHaveLength(12);
        expect(harness.exportData?.chapters.every((chapter) => chapter.images?.[0]?.blob.size === blobBytes)).toBe(
            true
        );
    });

    it("refetches image failures and legacy MIME records without reprocessing valid cache hits", async () => {
        const tasks = Array.from({ length: 3_000 }, (_, index) => createDownloadTask(index));
        const failedImageIndexes = Array.from({ length: 30 }, (_, index) => index * 50);
        const legacyMimeIndexes = Array.from({ length: 30 }, (_, index) => index * 50 + 1);
        const invalidIndexes = [...failedImageIndexes, ...legacyMimeIndexes].sort((left, right) => left - right);
        const chapters = new Map(
            tasks.map((task) => [
                task.index,
                createChapter(task.index, {
                    images: [
                        legacyMimeIndexes.includes(task.index)
                            ? ({
                                  ...createChapterImage(task.index),
                                  // 模拟早期缓存中尚未规范化的历史 MIME 记录
                                  mediaType: "application/octet-stream"
                              } as unknown as ChapterImage)
                            : createChapterImage(task.index)
                    ],
                    imageErrors: failedImageIndexes.includes(task.index) ? 1 : 0
                })
            ])
        );
        const harness = createStressDownloadHarness({
            tasks,
            chapters,
            imageEnabled: true,
            processChapter: (task) =>
                createChapter(task.index, {
                    images: [createChapterImage(task.index)],
                    imageErrors: 0
                })
        });

        await harness.run(createStressDownloadOptions(tasks, true));

        expect(harness.fetchedIndexes).toEqual(invalidIndexes);
        expect(harness.processedIndexes).toEqual(invalidIndexes);
        expect(harness.persistedIndexes).toEqual(invalidIndexes);
        expect(harness.exportData?.chapters).toHaveLength(3_000);
        expect(
            harness.exportData?.chapters.every(
                (chapter) => chapter.imageErrors === 0 && chapter.images?.[0]?.mediaType === "image/jpeg"
            )
        ).toBe(true);
    });
});
