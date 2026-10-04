import { normalizeChapterMappingFont } from "../../src/core/mapping-font";
import { vi } from "vitest";
import { runDownload } from "../../src/core/download/coordinator";
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
} from "../../src/core/download/contracts";
import type { Chapter } from "../../src/types";
import { createChapter } from "./factories";
import { FakeChapterFetcher, RecordingDownloadEvents } from "./fakes";

export function createDownloadHarness(tasks: DownloadTask[], chapters = new Map<number, Chapter>()) {
    const fetcher = new FakeChapterFetcher();
    for (const task of tasks) {
        fetcher.succeed(task.url, `<p>${task.title}</p>`);
    }
    const events = new RecordingDownloadEvents<DownloadEvent>();
    const processedIndexes: number[] = [];
    const cacheClears: Array<{ bookId: string; taskId: string }> = [];
    const cacheFinishes: Array<{ bookId: string; taskId: string; totalChapters: number }> = [];
    const ui = {
        snapshots: [] as DownloadSnapshot[],
        prepare: vi.fn(),
        update(snapshot: DownloadSnapshot) {
            this.snapshots.push(snapshot);
        },
        confirmMappingFontDownload: vi.fn(async () => true),
        confirmIncompleteChapters: vi.fn<
            (detection: IncompleteChapterDetection, signal?: AbortSignal) => Promise<IncompleteChapterDecision>
        >(async () => "export-with-placeholders"),
        promptProtectedChapterPassword: vi.fn(
            async (
                _prompt: ProtectedChapterPrompt,
                _signal?: AbortSignal,
                _onPendingDecision?: (
                    decision: Extract<ProtectedChapterDecision, { action: "skip-current" | "skip-all" | "cancel" }>
                ) => void
            ): Promise<ProtectedChapterDecision> => ({ action: "skip-current" })
        ),
        closeProtectedChapterPrompt: vi.fn(),
        updateMappingFontWarning: vi.fn(),
        showMappingFontFailure: vi.fn(),
        showTerminalFailure: vi.fn(),
        cleanup: vi.fn()
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
    const abortController = new AbortController();

    const log = vi.fn();
    const dependencies: DownloadDependencies = {
        chapters,
        cancellation: {
            signal: abortController.signal,
            isCancellationRequested: () => cancellationRequested,
            requestCancellation: vi.fn(() => {
                cancellationRequested = true;
                abortController.abort();
            }),
            subscribeCancellation: () => () => undefined
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
