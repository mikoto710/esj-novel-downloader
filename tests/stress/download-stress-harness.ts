import { vi } from "vitest";
import type { DownloadTask } from "../../src/download/contracts";
import type { Chapter } from "../../src/content/model";
import { createDownloadHarness } from "../support/download-harness";

interface StressDownloadHarnessOptions {
    chapters?: Map<number, Chapter>;
    processChapter?: (task: DownloadTask) => Promise<Chapter> | Chapter;
    putBatch?: () => Promise<boolean>;
}

export function createStressDownloadHarness(options: StressDownloadHarnessOptions) {
    const harness = createDownloadHarness(options.chapters);
    const { dependencies } = harness;
    dependencies.concurrency = 5;
    const processChapter = options.processChapter;
    if (processChapter) {
        dependencies.chapterProcessor.process = async (_html, task) => {
            harness.processedIndexes.push(task.index);
            return processChapter(task);
        };
    }
    const persistedBatches: number[][] = [];
    dependencies.cache.putBatch = async (_bookId, _taskId, entries) => {
        persistedBatches.push([...entries.keys()]);
        return options.putBatch?.() ?? true;
    };
    vi.spyOn(dependencies.cache, "finishForTask");
    vi.spyOn(dependencies.cache, "clearForTask");
    return {
        dependencies,
        persistedBatches,
        get persistedIndexes() {
            return persistedBatches.flat();
        },
        get fetchedIndexes() {
            return harness.fetcher.calls.map((task) => task.index);
        },
        processedIndexes: harness.processedIndexes,
        run: harness.run,
        get exportData() {
            return harness.exportData;
        }
    };
}

export function createStressDownloadOptions(tasks: DownloadTask[], imageEnabled = false) {
    return {
        bookId: "3000",
        taskId: "stress-task-3000",
        bookName: "Stress Test Novel",
        rawBookName: "Stress Test Novel",
        author: "Stress Test Author",
        introTxt: "Stress test introduction\n",
        description: "Stress test description",
        tags: [],
        pageUrl: "https://www.esjzone.cc/detail/3000.html",
        sourcePageType: "detail" as const,
        imageEnabled,
        tasks
    };
}
