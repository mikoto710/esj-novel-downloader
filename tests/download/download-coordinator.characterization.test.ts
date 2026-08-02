import { describe, expect, it, vi } from "vitest";
import { runDownload } from "../../src/core/download/coordinator";
import type {
    DownloadDependencies,
    DownloadEvent,
    DownloadSnapshot,
    DownloadTask
} from "../../src/core/download/contracts";
import type { CachedData, Chapter, RuntimeCacheSession } from "../../src/types";
import { createChapter, createDownloadTask, FakeChapterFetcher, RecordingDownloadEvents } from "../support";
import { MappingFontError } from "../../src/core/mapping-font";

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

    it("starts resumed progress from valid cached chapters and only schedules missing chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
        const harness = createHarness(
            tasks,
            new Map([
                [0, createChapter(0)],
                [1, createChapter(1)]
            ])
        );

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([2]);
        expect(harness.processedIndexes).toEqual([2]);
        expect(harness.events.ofType("chapter-restored")).toHaveLength(2);
        expect(
            harness.ui.snapshots.find((snapshot) => snapshot.phase === "downloading" && snapshot.completedCount === 2)
        ).toMatchObject({ restoredCount: 2, cachedChapterCount: 2 });
        expect(harness.dependencies.log).not.toHaveBeenCalledWith(expect.stringContaining("正在预检"));
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

    it("asks for consent once and publishes a persistent summary for mapped chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async (_html, task) =>
            createMappedChapter(task.index, String(task.index + 1));

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.ui.confirmMappingFontDownload).toHaveBeenCalledOnce();
        expect(harness.ui.confirmMappingFontDownload).toHaveBeenCalledWith(
            expect.objectContaining({ task: tasks[0], chapterCount: 1, fontBytes: 64, inFlightLimit: 1 })
        );
        expect(harness.ui.updateMappingFontWarning).toHaveBeenLastCalledWith({ chapterCount: 2, fontBytes: 128 });
        expect(harness.ui.showFormatChoice).toHaveBeenCalledOnce();
    });

    it("stops without publishing export data when mapped chapter consent is rejected", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async (_html, task) =>
            createMappedChapter(task.index, String(task.index + 1));
        harness.ui.confirmMappingFontDownload.mockResolvedValue(false);

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([0]);
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
        expect(harness.exportData).toBeNull();
        expect(harness.ui.cleanup).toHaveBeenCalledOnce();
    });

    it("blocks export and reports chapters whose mapped font remains invalid after retry", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.chapterProcessor.process = async () => {
            throw new MappingFontError("woff2-invalid", "invalid test font");
        };

        await expect(runDownload(createOptions(tasks), harness.dependencies)).rejects.toThrow(
            "1 个章节的映射字体无法解析"
        );

        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledOnce();
        expect(harness.ui.showMappingFontFailure).toHaveBeenCalledWith([
            expect.objectContaining({ task: tasks[0], message: expect.stringContaining("invalid test font") })
        ]);
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
    });

    it("retries an unexpected storage abort once and still completes", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        const putBatch = vi
            .fn()
            .mockRejectedValueOnce(new DOMException("transaction aborted", "AbortError"))
            .mockResolvedValueOnce(true);
        harness.dependencies.cache.putBatch = putBatch;

        await runDownload(createOptions(tasks), harness.dependencies);

        expect(putBatch).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.log).toHaveBeenCalledWith(expect.stringContaining("正在进行一次安全重试"));
        expect(harness.ui.showFormatChoice).toHaveBeenCalledOnce();
    });

    it("propagates a classified storage failure without turning it into user cancellation", async () => {
        const tasks = [createDownloadTask(0)];
        const harness = createHarness(tasks);
        harness.dependencies.cache.putBatch = vi.fn(async () => false);

        await expect(runDownload(createOptions(tasks), harness.dependencies)).rejects.toMatchObject({
            reason: "ownership-lost",
            operation: "write"
        });

        expect(harness.dependencies.runtime.requestCancellation).not.toHaveBeenCalled();
        expect(harness.ui.showFormatChoice).not.toHaveBeenCalled();
        expect(harness.ui.snapshots.at(-1)).toMatchObject({
            phase: "failed",
            storageFailure: { reason: "ownership-lost", operation: "write" }
        });
        expect(harness.events.ofType("cache-write-finished").at(-1)).toMatchObject({
            saved: false,
            failure: { reason: "ownership-lost", operation: "write" }
        });
    });
});

function createMappedChapter(index: number, family: string): Chapter {
    return createChapter(index, {
        content: `<section style="font-family: '${family}', sans-serif;"><p>Mapped body</p></section>`,
        mappingFont: {
            family,
            blob: new Blob([new Uint8Array(64)], { type: "font/woff2" }),
            mediaType: "font/woff2",
            sha256: family.padStart(64, "a")
        }
    });
}

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
        confirmMappingFontDownload: vi.fn(async () => true),
        updateMappingFontWarning: vi.fn(),
        showMappingFontFailure: vi.fn(),
        cleanup: vi.fn(),
        showFormatChoice: vi.fn()
    };
    let exportData: CachedData | null = null;
    let runtimeSession: RuntimeCacheSession | null = null;
    let cancellationRequested = false;

    const dependencies: DownloadDependencies = {
        runtime: {
            chapters,
            signal: new AbortController().signal,
            activeBookLock: null,
            originalTitle: "Test",
            isCancellationRequested: () => cancellationRequested,
            requestCancellation: vi.fn(() => {
                cancellationRequested = true;
            }),
            subscribeCancellation: () => () => undefined,
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
        coverCache: { load: async () => null, put: async () => true },
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
            getConcurrency: () => 1
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
        imageEnabled: false,
        tasks
    };
}
