import { normalizeChapterMappingFont } from "../../src/content/mapping-font";
import { vi } from "vitest";
import { runDownload } from "../../src/download/run";
import type {
    DownloadDependencies,
    DownloadOptions,
    DownloadResult,
    DownloadEvent,
    DownloadSnapshot,
    DownloadTask,
    IncompleteChapterDecision,
    IncompleteChapterDetection,
    ProtectedChapterDecision,
    ProtectedChapterPrompt,
    ProtectedChapterUnlockResult
} from "../../src/download/contracts";
import type { Chapter } from "../../src/content/model";
import { createChapter } from "./factories";
import { RecordingDownloadEvents } from "./fakes";

export function createDownloadHarness(chapters = new Map<number, Chapter>()) {
    const fetched: DownloadTask[] = [];
    const fetcher = {
        isSiteChapter: () => true,
        calls: fetched,
        async fetch(task: DownloadTask, signal?: AbortSignal) {
            fetched.push({ ...task });
            if (signal?.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            return `<p>${task.title}</p>`;
        }
    };
    const events = new RecordingDownloadEvents<DownloadEvent>();
    const processedIndexes: number[] = [];
    const cacheClears: Array<{ bookId: string; taskId: string }> = [];
    const cacheFinishes: Array<{ bookId: string; taskId: string; totalChapters: number }> = [];
    const ui = {
        snapshots: [] as DownloadSnapshot[],
        update(snapshot: DownloadSnapshot) {
            this.snapshots.push(snapshot);
        },
        confirmMappingFontDownload: vi.fn(async () => true),
        confirmIncompleteChapters: vi.fn<
            (detection: IncompleteChapterDetection, signal?: AbortSignal) => Promise<IncompleteChapterDecision>
        >(async () => "export-with-placeholders"),
        promptProtectedChapterPassword: vi.fn(
            async (_prompt: ProtectedChapterPrompt, _signal?: AbortSignal): Promise<ProtectedChapterDecision> => ({
                action: "skip-current"
            })
        ),
        closeProtectedChapterPrompt: vi.fn(),
        updateMappingFontWarning: vi.fn()
    };
    const protectedChapterDetector = { isProtected: vi.fn(() => false) };
    const protectedChapterAuth = {
        unlock: vi.fn(
            async (): Promise<ProtectedChapterUnlockResult> => ({
                kind: "protocol-error",
                code: "response-invalid"
            })
        )
    };
    let result: DownloadResult | null = null;
    let cancellationRequested = false;
    let requestedAt: number | null = null;
    let cancellationMode: "flush" | "discard" = "flush";
    const cancellationListeners = new Set<(mode: "flush" | "discard") => void>();
    const abortController = new AbortController();

    const log = vi.fn();
    const dependencies: DownloadDependencies = {
        cancellation: {
            signal: abortController.signal,
            get mode() {
                return cancellationMode;
            },
            get requestedAt() {
                return requestedAt;
            },
            isCancellationRequested: () => cancellationRequested,
            requestCancellation: vi.fn((mode: "flush" | "discard" = "flush") => {
                if (cancellationRequested && (cancellationMode === "discard" || mode === "flush")) return;
                requestedAt ??= Date.now();
                cancellationMode = mode;
                cancellationRequested = true;
                abortController.abort();
                cancellationListeners.forEach((listener) => listener(cancellationMode));
            }),
            subscribeCancellation(listener) {
                cancellationListeners.add(listener);
                if (requestedAt !== null) listener(cancellationMode);
                return () => cancellationListeners.delete(listener);
            }
        },
        ui,
        chapterFetcher: fetcher,
        chapterProcessor: {
            normalizeCached: normalizeChapterMappingFont,
            async process(_html, task) {
                processedIndexes.push(task.index);
                return createChapter(task.index);
            }
        },
        protectedChapterDetector,
        protectedChapterAuth,
        coverFetcher: { fetch: async () => null },
        coverCache: { load: async () => null, put: async () => true },
        cache: {
            putBatch: async () => true,
            async finishForTask(bookId, taskId, meta) {
                cacheFinishes.push({ bookId, taskId, totalChapters: meta.totalChapters });
                return true;
            },
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
        concurrency: 1,
        fallbackPageUrl: "https://www.esjzone.cc/detail/100.html",
        startedAt: Date.parse("2026-01-01T00:00:00.000Z"),
        log
    };

    return {
        dependencies,
        events,
        fetcher,
        processedIndexes,
        cacheClears,
        cacheFinishes,
        ui,
        log,
        async run(options: DownloadOptions) {
            options.initialChapters ??= chapters;
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
