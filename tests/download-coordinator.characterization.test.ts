import { describe, expect, it, vi } from "vitest";
import { runDownload } from "../src/core/download/coordinator";
import type {
    DownloadDependencies,
    DownloadEvent,
    DownloadSnapshot,
    DownloadTask
} from "../src/core/download/contracts";
import type { CachedData, Chapter, RuntimeCacheSession } from "../src/types";
import { createChapter, createDownloadTask, FakeChapterFetcher, RecordingDownloadEvents } from "./support";

describe("runDownload characterization", () => {
    it("runs without DOM, IndexedDB, GM APIs, or global application state", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks, new Map([[0, createChapter(0)]]));

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([1]);
        expect(harness.processedIndexes).toEqual([1]);
        expect(harness.exportData?.chapters.map((chapter) => chapter.title)).toEqual(["第 1 章", "第 2 章"]);
        expect(harness.cacheClears).toEqual([{ bookId: "100", taskId: "task-100" }]);
        expect(harness.ui.showFormatChoice).toHaveBeenCalledOnce();
        expect(harness.ui.cleanup).toHaveBeenCalledOnce();
    });

    it("publishes structured phases and progress while preserving small-download results", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(
            harness.events
                .ofType("phase-changed")
                .map((event) => (event as Extract<DownloadEvent, { type: "phase-changed" }>).current)
        ).toEqual([
            "preparing",
            "restoring-cache",
            "downloading",
            "flushing-cache",
            "checking-integrity",
            "flushing-cache",
            "preparing-export",
            "export-ready"
        ]);
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "export-ready",
            scheduledCount: 2,
            fetchedCount: 2,
            processedCount: 2,
            completedCount: 2,
            hasExportData: true
        });
        expect(harness.exportData?.txt).toContain("第 1 章正文");
        expect(harness.exportData?.txt).toContain("第 2 章正文");
    });
});

function createHarness(tasks: DownloadTask[], chapters = new Map<number, Chapter>()) {
    const fetcher = new FakeChapterFetcher();
    for (const task of tasks) {
        fetcher.succeed(task.url, `<p>${task.title}</p>`);
    }
    const events = new RecordingDownloadEvents<DownloadEvent>();
    const processedIndexes: number[] = [];
    const cacheClears: Array<{ bookId: string; taskId: string }> = [];
    const ui = {
        snapshots: [] as DownloadSnapshot[],
        prepare: vi.fn(),
        update(snapshot: DownloadSnapshot) {
            this.snapshots.push(snapshot);
        },
        cleanup: vi.fn(),
        showFormatChoice: vi.fn()
    };
    let exportData: CachedData | null = null;
    let runtimeSession: RuntimeCacheSession | null = null;

    const dependencies: DownloadDependencies = {
        runtime: {
            chapters,
            signal: new AbortController().signal,
            activeBookLock: null,
            originalTitle: "Test",
            isCancellationRequested: () => false,
            requestCancellation: vi.fn(),
            startCacheSession(meta, taskId, initialChapterCount) {
                runtimeSession = {
                    ...meta,
                    taskId,
                    completedCount: 0,
                    cachedChapterCount: initialChapterCount,
                    status: "downloading",
                    hasExportData: false
                };
            },
            updateCacheSession(progress) {
                if (runtimeSession) {
                    runtimeSession = { ...runtimeSession, ...progress };
                }
            },
            setExportData(data) {
                exportData = data;
            }
        },
        ui,
        chapterFetcher: fetcher,
        chapterProcessor: {
            async process(_html, task) {
                processedIndexes.push(task.index);
                return createChapter(task.index);
            }
        },
        coverFetcher: { fetch: async () => null },
        cache: {
            putBatch: async () => true,
            async clearForTask(bookId, taskId) {
                cacheClears.push({ bookId, taskId });
                return true;
            }
        },
        lock: {
            owns: async () => true,
            shouldDiscardCache: async () => false
        },
        events,
        scheduler: {
            sleep: async () => undefined,
            sleepWithAbort: async () => undefined,
            randomDelay: () => 0,
            schedule: () => () => undefined
        },
        settings: {
            getConcurrency: () => 1,
            isImageDownloadEnabled: () => false
        },
        environment: {
            currentUrl: () => "https://www.esjzone.cc/detail/100.html",
            now: () => Date.parse("2026-01-01T00:00:00.000Z")
        },
        log: vi.fn()
    };

    return {
        dependencies,
        events,
        fetcher,
        processedIndexes,
        cacheClears,
        ui,
        get exportData() {
            return exportData;
        }
    };
}

function createOptions(tasks: DownloadTask[]) {
    return {
        bookId: "100",
        taskId: "task-100",
        bookName: "测试小说",
        rawBookName: "测试小说",
        author: "测试作者",
        introTxt: "测试简介\n",
        description: "测试描述",
        tags: [],
        pageUrl: "https://www.esjzone.cc/detail/100.html",
        sourcePageType: "detail" as const,
        tasks
    };
}
