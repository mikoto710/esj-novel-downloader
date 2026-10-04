import { normalizeChapterMappingFont } from "../../src/core/mapping-font";
import { runDownload } from "../../src/core/download/coordinator";
import { vi } from "vitest";
import type {
    DownloadDependencies,
    DownloadOptions,
    DownloadResult,
    DownloadEvent,
    DownloadSnapshot,
    DownloadTask
} from "../../src/core/download/contracts";
import type { Chapter, DownloadCancellationMode } from "../../src/types";
import { createChapter, RecordingDownloadEvents } from "../support";

interface StressDownloadHarnessOptions {
    tasks: DownloadTask[];
    chapters?: Map<number, Chapter>;
    imageEnabled?: boolean;
    concurrency?: number;
    processChapter?: (task: DownloadTask) => Promise<Chapter> | Chapter;
    putBatch?: (entries: ReadonlyMap<number, Chapter>, signal?: AbortSignal) => Promise<boolean>;
    finishForTask?: (signal?: AbortSignal) => Promise<boolean>;
    clearForTask?: (signal?: AbortSignal) => Promise<boolean>;
}

export function createStressDownloadHarness(options: StressDownloadHarnessOptions) {
    const chapters = options.chapters ?? new Map<number, Chapter>();
    const fetchedIndexes: number[] = [];
    const processedIndexes: number[] = [];
    const persistedIndexes: number[] = [];
    const persistedBatches: number[][] = [];
    const snapshots: DownloadSnapshot[] = [];
    const events = new RecordingDownloadEvents<DownloadEvent>();
    const controller = new AbortController();
    const cancellationListeners = new Set<(mode: DownloadCancellationMode) => void>();
    let cancellationMode: DownloadCancellationMode | null = null;
    let result: DownloadResult | null = null;

    const requestCancellation = vi.fn((mode: DownloadCancellationMode = "flush") => {
        if (cancellationMode === "discard" || (cancellationMode === "flush" && mode === "flush")) {
            return;
        }
        cancellationMode = mode;
        controller.abort();
        for (const listener of cancellationListeners) {
            listener(mode);
        }
    });

    const dependencies: DownloadDependencies = {
        chapters,
        cancellation: {
            signal: controller.signal,
            isCancellationRequested: () => cancellationMode !== null,
            requestCancellation,
            subscribeCancellation(listener) {
                cancellationListeners.add(listener);
                return () => cancellationListeners.delete(listener);
            }
        },
        ui: {
            prepare: vi.fn(),
            update(snapshot) {
                snapshots.push(snapshot);
            },
            confirmMappingFontDownload: vi.fn(async () => true),
            confirmIncompleteChapters: vi.fn(async () => "export-with-placeholders" as const),
            promptProtectedChapterPassword: vi.fn(async () => ({ action: "skip-current" }) as const),
            closeProtectedChapterPrompt: vi.fn(),
            updateMappingFontWarning: vi.fn(),
            showMappingFontFailure: vi.fn(),
            showTerminalFailure: vi.fn(),
            cleanup: vi.fn()
        },
        chapterFetcher: {
            async fetch(task) {
                fetchedIndexes.push(task.index);
                return `<p>${task.title}</p>`;
            }
        },
        chapterProcessor: {
            normalizeCached: normalizeChapterMappingFont,
            async process(_html, task) {
                processedIndexes.push(task.index);
                return options.processChapter?.(task) ?? createChapter(task.index);
            }
        },
        protectedChapterDetector: { isProtected: () => false },
        protectedChapterAuth: {
            unlock: async () => ({ kind: "protocol-error", code: "response-invalid", message: "unused" })
        },
        coverFetcher: { fetch: async () => null },
        coverCache: { load: async () => null, put: async () => true },
        cache: {
            async putBatch(_bookId, _taskId, entries, _meta, signal) {
                const indexes = Array.from(entries.keys());
                persistedIndexes.push(...indexes);
                persistedBatches.push(indexes);
                return options.putBatch?.(entries, signal) ?? true;
            },
            finishForTask: vi.fn(async (_bookId, _taskId, _meta, signal) => {
                return options.finishForTask?.(signal) ?? true;
            }),
            clearForTask: vi.fn(async (_bookId, _taskId, signal) => {
                return options.clearForTask?.(signal) ?? true;
            })
        },
        lock: {
            owns: async () => true,
            shouldDiscardCache: async () => cancellationMode === "discard"
        },
        events,
        scheduler: {
            sleep: async () => undefined,
            sleepWithAbort: async () => undefined,
            randomDelay: () => 0,
            schedule: () => () => undefined
        },
        concurrency: options.concurrency ?? 5,
        fallbackPageUrl: "https://www.esjzone.cc/detail/3000.html",
        startedAt: Date.parse("2026-01-01T00:00:00.000Z"),
        log: vi.fn()
    };

    return {
        dependencies,
        events,
        fetchedIndexes,
        processedIndexes,
        persistedIndexes,
        persistedBatches,
        snapshots,
        requestCancellation,
        async run(options: DownloadOptions) {
            result = await runDownload(options, dependencies);
            return result;
        },
        get result() {
            return result;
        },
        get exportData() {
            return result?.status === "ready" ? result.data : null;
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
