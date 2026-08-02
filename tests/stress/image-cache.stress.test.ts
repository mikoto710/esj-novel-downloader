import { describe, expect, it } from "vitest";
import { runDownload } from "../../src/core/download/coordinator";
import type { ChapterImage } from "../../src/types";
import { createChapter, createChapterImage, createDownloadTask } from "../support";
import { createStressDownloadHarness, createStressDownloadOptions } from "./download-stress-harness";

describe("image cache pressure", () => {
    it("persists 3000 chapters with small image metadata in bounded batches", async () => {
        const tasks = Array.from({ length: 3_000 }, (_, index) => createDownloadTask(index));
        const harness = createStressDownloadHarness({
            tasks,
            imageEnabled: true,
            processChapter: (task) =>
                createChapter(task.index, {
                    content: `<p><img src="img_${task.index}_0.jpg"></p>`,
                    images: [createChapterImage(task.index)]
                })
        });

        await runDownload(createStressDownloadOptions(tasks, true), harness.dependencies);

        expect(harness.persistedIndexes).toHaveLength(3_000);
        expect(harness.persistedBatches).toHaveLength(120);
        expect(Math.max(...harness.persistedBatches.map((batch) => batch.length))).toBe(25);
        expect(harness.exportData?.chapters).toHaveLength(3_000);
        expect(harness.exportData?.chapters.every((chapter) => chapter.images?.length === 1)).toBe(true);
    });

    it("flushes large image blobs before the byte queue can grow without bound", async () => {
        const tasks = Array.from({ length: 12 }, (_, index) => createDownloadTask(index));
        const harness = createStressDownloadHarness({
            tasks,
            imageEnabled: true,
            processChapter: (task) => {
                const bytes = new Uint8Array(1024 * 1024);
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

        await runDownload(createStressDownloadOptions(tasks, true), harness.dependencies);

        expect(harness.persistedBatches.map((batch) => batch.length)).toEqual([4, 4, 4]);
        expect(harness.persistedIndexes).toHaveLength(12);
        expect(harness.exportData?.chapters.every((chapter) => chapter.images?.[0]?.blob.size === 1024 * 1024)).toBe(
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

        await runDownload(createStressDownloadOptions(tasks, true), harness.dependencies);

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
