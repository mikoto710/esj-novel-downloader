import { describe, expect, it } from "vitest";
import { createChapter, createChapterImage, createDeferred, createDownloadTask } from "../support";
import { createStressDownloadHarness, createStressDownloadOptions } from "./download-stress-harness";
import { createChapterSelection } from "../../src/download/plan";

describe("download resilience pressure", () => {
    it.each([
        { label: "late range", indexes: Array.from({ length: 25 }, (_, index) => index + 2_975) },
        { label: "sparse selection", indexes: [0, 799, 1_500, 2_975, 2_999] }
    ])("exports $label from a 3000-chapter image cache without clearing unselected chapters", async ({ indexes }) => {
        const sourceTasks = Array.from({ length: 3_000 }, (_, index) => createDownloadTask(index));
        const chapters = new Map(
            sourceTasks.map((task) => [
                task.index,
                createChapter(task.index, { images: [createChapterImage(task.index)] })
            ])
        );
        const selectedTasks = indexes.map((index) => sourceTasks[index]);
        const harness = createStressDownloadHarness({
            tasks: selectedTasks,
            chapters,
            imageEnabled: true
        });

        await harness.run({
            ...createStressDownloadOptions(selectedTasks, true),
            selection: createChapterSelection(indexes, sourceTasks.length)
        });

        expect(harness.fetchedIndexes).toEqual([]);
        expect(harness.exportData?.chapters.map((chapter) => chapter.title)).toEqual(
            indexes.map((index) => `第 ${index + 1} 章`)
        );
        expect(harness.dependencies.cache.finishForTask).toHaveBeenCalledOnce();
        expect(harness.dependencies.cache.clearForTask).not.toHaveBeenCalled();
        expect(chapters).toHaveLength(3_000);
    });

    it("bounds chapter processing while a slow cache write applies backpressure", async () => {
        const tasks = Array.from({ length: 300 }, (_, index) => createDownloadTask(index));
        const firstWriteStarted = createDeferred<void>();
        const releaseFirstWrite = createDeferred<boolean>();
        let writeCount = 0;
        const harness = createStressDownloadHarness({
            tasks,
            concurrency: 5,
            putBatch: async () => {
                writeCount += 1;
                if (writeCount === 1) {
                    firstWriteStarted.resolve();
                    return releaseFirstWrite.promise;
                }
                return true;
            }
        });

        const downloadPromise = harness.run(createStressDownloadOptions(tasks));
        try {
            await firstWriteStarted.promise;
            // 保持首批写入阻塞，在本轮可执行任务耗尽后观察处理推进上限
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(harness.processedIndexes.length).toBeGreaterThanOrEqual(25);
            expect(harness.processedIndexes.length).toBeLessThanOrEqual(125);
        } finally {
            releaseFirstWrite.resolve(true);
        }

        expect((await downloadPromise).status).toBe("ready");
        const indexes = tasks.map((task) => task.index);
        expect(harness.processedIndexes.toSorted((left, right) => left - right)).toEqual(indexes);
        expect(harness.persistedIndexes.toSorted((left, right) => left - right)).toEqual(indexes);
        expect(harness.persistedBatches.every((batch) => batch.length > 0 && batch.length <= 25)).toBe(true);
    });
});
