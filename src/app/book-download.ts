import {
    browserDiagnosticLog,
    finishBrowserDiagnosticSession,
    recordBrowserDiagnosticFailure,
    recordBrowserDownloadEvent,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../adapters/browser-diagnostics";
import { fetchWithTimeout } from "../browser/request";
import { sleep, sleepWithAbort } from "../browser/timing";
import { normalizeChapterMappingFont } from "../content/mapping-font";
import type { Chapter } from "../content/model";
import type { LocaleKey } from "../core/locale";
import {
    activateDownload,
    clearRuntimeCacheSession,
    isCurrentDownload,
    publishCachedExport,
    releaseActiveDownload,
    startRuntimeCacheSession,
    state,
    updateRuntimeCacheSession
} from "./page-session";
import type {
    BookLockService,
    ChapterCacheRepository,
    ChapterProcessorPort,
    CoverCacheRepository,
    CoverFetcherPort,
    DownloadCancellationPort,
    DownloadDependencies,
    DownloadLog,
    DownloadResult,
    DownloadUiPort
} from "../download/contracts";
import type { DownloadSelection } from "../download/plan";
import { createDownloadPlan, selectDownloadTasks } from "../download/plan";
import { runDownload } from "../download/run";
import { BookPreflightError, type PreparedBook } from "../site/book";
import { createChapterFetcher, parseChapterHtml, processParsedChapter } from "../site/chapter";
import { fetchBookCover, type ImageProcessingFailure } from "../site/images";
import { createProtectedChapterAuth, isProtectedChapterHtml } from "../site/protected-chapter";
import { RequestGate } from "../site/request-gate";
import type { BookDownloadLock } from "../storage/book-lock";
import {
    acquireBookDownloadLock,
    getConflictingBookDownloadLock,
    markBookDownloadRunning,
    ownsActiveBookDownloadLock,
    releaseBookDownloadLock,
    shouldDiscardBookDownloadCache,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../storage/book-lock";
import {
    claimBookCache,
    clearBookCacheForTask,
    finishBookCacheForTask,
    loadBookCover,
    previewBookCache,
    putBookCacheBatchForTask,
    putBookCoverForTask,
    type BookCachePreviewResult
} from "../storage/cache/book-cache";
import {
    createStorageError,
    normalizeStorageError,
    StorageError,
    toStorageFailure,
    type StorageFailure
} from "../storage/cache/storage-error";
import { publishCacheSyncEvent } from "../storage/cache/sync";
import { getConcurrency, getImageDownloadSetting } from "../storage/settings";
import type { DownloadCancellationMode, SourcePageType } from "../types";
import { createDownloadSelectionPopup } from "../ui/dialogs/download-selection";
import { showMessagePopup } from "../ui/dialogs/message";
import { createDownloadView } from "../ui/download-view";
import { t } from "../ui/locale";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../ui/messages/download-terminal";
import { formatStorageFailure } from "../ui/messages/storage-failure";
import { showBookDownloadInProgressPopup, showFormatChoice } from "../ui/popups";
import { fullCleanup } from "../utils/dom";
import { log } from "../utils/log";

type BookSourcePageType = Extract<SourcePageType, "detail" | "forum">;
interface RunBookDownloadOptions {
    bookId: string;
    sourcePageType: BookSourcePageType;
    pageTitle: string;
    loadPlan(): Promise<PreparedBook>;
}

/**
 * 预检冲突并选择范围，再取得锁执行同一任务流程
 */
export async function runBookDownload(options: RunBookDownloadOptions): Promise<void> {
    const { bookId, sourcePageType } = options;
    state.originalTitle = options.pageTitle;
    const imageEnabled = getImageDownloadSetting();
    const previousExport = state.cachedData;
    let plan: PreparedBook | undefined;
    let preview: BookCachePreviewResult | undefined;
    let preparationErrorKey: LocaleKey | undefined;
    let storageStage: "lock-read" | "cache-read" = "lock-read";

    try {
        // 预检只提前提示，确认后的原子获取仍负责互斥
        const conflictingLock = await getConflictingBookDownloadLock(bookId);
        if (conflictingLock) {
            showBookDownloadInProgressPopup(conflictingLock);
            return;
        }

        storageStage = "cache-read";
        plan = await options.loadPlan().catch((error: unknown) => {
            throw error instanceof BookPreflightError
                ? error
                : new BookPreflightError("detail-fetch-failed", "book-metadata", { cause: error });
        });
        if (plan.tasks.length === 0) {
            throw new BookPreflightError("chapter-list-missing", "chapter-list");
        }
        preview = await previewBookCache(bookId, imageEnabled);
    } catch (error) {
        const failure = error instanceof BookPreflightError ? error : normalizeStorageError(error, "read");
        preparationErrorKey =
            failure instanceof BookPreflightError
                ? failure.code === "chapter-list-missing"
                    ? "page.chaptersMissing.message"
                    : "page.detailFailed.message"
                : "page.cacheUnavailable.message";
        recordBrowserPreflightDiagnosticFailure({
            bookId,
            bookTitle: options.pageTitle,
            pageUrl: location.href,
            sourcePageType,
            imageEnabled,
            failure: {
                scope: failure instanceof BookPreflightError ? "page" : "storage",
                stage: failure instanceof BookPreflightError ? failure.stage : storageStage,
                code: failure instanceof BookPreflightError ? failure.code : failure.reason,
                message: failure.message
            }
        });
    }

    let initialSelection: DownloadSelection | undefined;
    while (true) {
        const invalidatesCache = Boolean(preview && preview.size > 0 && preview.compatibility !== "compatible");
        const decision = await createDownloadSelectionPopup({
            tasks: plan?.tasks || [],
            cachedIndexes: new Set(preview?.indexes || []),
            cacheWillBeInvalidated: invalidatesCache,
            cacheCount: preview?.size || 0,
            imageEnabled,
            hasExistingExport: Boolean(previousExport),
            ...(previousExport?.exportContext?.selection
                ? { existingSelection: previousExport.exportContext.selection }
                : {}),
            ...(initialSelection ? { initialSelection } : {}),
            ...(preparationErrorKey ? { preparationErrorKey } : {})
        });
        if (decision.action === "open-existing") {
            if (previousExport) {
                showFormatChoice(previousExport);
            }
            return;
        }
        if (decision.action === "cancel" || !plan || !preview || preparationErrorKey) {
            return;
        }
        initialSelection = decision.selection;
        // 仅未确认的缓存失效返回新预览；释放锁后再让用户选择
        const latest = await executeBookDownload(options, plan, decision.selection, imageEnabled, invalidatesCache);
        if (!latest) {
            return;
        }
        preview = latest;
    }
}

/**
 * 持锁执行下载，所有退出路径统一释放资源
 */
async function executeBookDownload(
    options: RunBookDownloadOptions,
    plan: PreparedBook,
    inputSelection: DownloadSelection,
    imageEnabled: boolean,
    allowInvalidation: boolean
): Promise<BookCachePreviewResult | undefined> {
    const { bookId, sourcePageType } = options;
    const downloadPlan = createDownloadPlan({
        tasks: selectDownloadTasks(plan.tasks, inputSelection),
        selection: inputSelection
    });
    const selection = downloadPlan.selection;
    const selectedTasks = [...downloadPlan.tasks];
    const cancellation = createDownloadCancellation();
    const lockResult = await acquireBookDownloadLock(bookId, sourcePageType);
    if (!lockResult.acquired) {
        fullCleanup(options.pageTitle);
        showBookDownloadInProgressPopup(lockResult.lock);
        return;
    }

    const lock = lockResult.lock;
    const log = (message: Parameters<typeof browserDiagnosticLog>[0]) =>
        browserDiagnosticLog(message, lock.taskId, isCurrentDownload(lock.taskId));
    let ui: DownloadUiPort | undefined;
    let cleaned = false;
    const cleanup = () => {
        if (ui) {
            ui.cleanup();
        } else if (!cleaned && isCurrentDownload(lock.taskId)) {
            fullCleanup(options.pageTitle);
        }
        cleaned = true;
    };
    let stopHeartbeat: () => void = () => undefined;
    let diagnosticStarted = false;
    let downloadStarted = false;
    let exportReady = false;

    try {
        activateDownload(bookId, lock.taskId, cancellation);
        stopHeartbeat = startBookDownloadLockHeartbeat(lock, cancellation.requestCancellation);
        ui = createDownloadView({ taskId: lock.taskId, cancellation, originalTitle: options.pageTitle });
        ui.prepare(selection);
        startBrowserDiagnosticSession(
            {
                taskId: lock.taskId,
                bookId,
                bookTitle: plan.meta.rawBookName || plan.meta.bookName,
                pageUrl: plan.pageUrl,
                sourcePageType,
                totalChapters: downloadPlan.tasks.length,
                selection: downloadPlan.summary,
                imageEnabled
            },
            { observePageClose: true }
        );
        diagnosticStarted = true;
        log(t("page.cachePreparing"));
        const claimedCache = await claimBookCache(bookId, lock.taskId, imageEnabled, cancellation.signal, {
            allowInvalidation
        });
        if (claimedCache.status === "needs-confirmation") {
            cleanup();
            return claimedCache;
        }
        const chapters = claimedCache.map || new Map();
        if (claimedCache.invalidatedCount > 0) {
            log(
                claimedCache.compatibility === "unknown"
                    ? t("page.cacheInvalidLegacyImage", { count: claimedCache.invalidatedCount })
                    : t("page.cacheInvalidImageMismatch", { count: claimedCache.invalidatedCount })
            );
        }
        if (cancellation.isCancellationRequested()) {
            cleanup();
            return;
        }

        await updateBookDownloadLockTitle(lock, plan.meta.rawBookName || plan.meta.bookName);
        if (cancellation.isCancellationRequested() || !(await markBookDownloadRunning(lock))) {
            if (!cancellation.isCancellationRequested()) {
                recordBrowserDiagnosticFailure(
                    {
                        scope: "storage",
                        stage: "lock-start",
                        code: "ownership-lost",
                        message: "ownership-lost"
                    },
                    lock.taskId
                );
            }
            log(t("page.notStarted"));
            cleanup();
            if (!cancellation.isCancellationRequested()) {
                showDownloadTerminalFailure({
                    kind: "cancellation",
                    outcome: "ownership-lost",
                    storageFailure: null
                });
            }
            return;
        }

        const downloadOptions = {
            bookId,
            taskId: lock.taskId,
            bookName: plan.meta.bookName,
            rawBookName: plan.meta.rawBookName,
            author: plan.meta.author,
            introTxt: plan.meta.introTxt,
            description: plan.meta.description,
            tags: plan.meta.tags,
            ...(plan.meta.coverUrl === undefined ? {} : { coverUrl: plan.meta.coverUrl }),
            pageUrl: plan.pageUrl,
            sourcePageType,
            imageEnabled,
            tasks: selectedTasks,
            selection
        } as const;
        updateBrowserDiagnosticSession(downloadOptions);
        downloadStarted = true;
        const dependencies = createDownloadDependencies({ lock, chapters, cancellation, ui });
        let result: DownloadResult;
        try {
            result = await runDownload(downloadOptions, dependencies);
        } finally {
            // 输入拒绝或核心尚未进入 try，也必须结束本任务的界面订阅
            cleanup();
        }
        if (result.status === "ready" && isCurrentDownload(lock.taskId)) {
            publishCachedExport(result.data, lock.taskId);
            exportReady = true;
            showFormatChoice(result.data);
        }
    } catch (error) {
        const details = error instanceof Error ? error : new Error(String(error));
        if (
            cancellation.isCancellationRequested() ||
            details.name === "AbortError" ||
            details.message === "User Aborted"
        ) {
            cleanup();
            return;
        }
        console.error(error);
        if (!downloadStarted && isCurrentDownload(lock.taskId)) {
            recordBrowserDiagnosticFailure(
                {
                    scope: error instanceof StorageError ? "storage" : "page",
                    stage: `${sourcePageType}-page`,
                    code: error instanceof StorageError ? error.reason : details.name || "range-page-failed",
                    message: details.message
                },
                lock.taskId
            );
            const displayMessage =
                error instanceof StorageError ? formatStorageFailure(toStorageFailure(error)) : details.message;
            log(
                error instanceof StorageError
                    ? t("page.progressNotSaved", { detail: displayMessage })
                    : t("page.flowFailed", { detail: displayMessage })
            );
            cleanup();
            showMessagePopup({
                tone: "error",
                title: t("page.startFailed.title"),
                message: error instanceof StorageError ? displayMessage : t("page.startFailed.message"),
                ...(error instanceof StorageError ? {} : { details: details.message })
            });
        }
    } finally {
        // 仅补齐提前退出的诊断，不覆盖核心已记录的终态
        if (diagnosticStarted) {
            finishBrowserDiagnosticSession(
                lock.taskId,
                cancellation.isCancellationRequested() ? "cancelled" : "failed"
            );
        }
        const wasCurrent = isCurrentDownload(lock.taskId);
        // 装配或初始化失败仍结束视图；清理异常不能跳过书籍锁收尾
        let finalization: BookDownloadFinalizationResult;
        try {
            cleanup();
        } finally {
            finalization = await finalizeBookDownloadTask(lock, stopHeartbeat, log);
        }
        if (finalization.cacheClearFailure) {
            recordBrowserDiagnosticFailure(
                {
                    scope: "storage",
                    stage: "cache-discard",
                    code: finalization.cacheClearFailure.reason,
                    message: finalization.cacheClearFailure.message
                },
                lock.taskId
            );
            if (wasCurrent && !state.activeDownload) {
                showCacheDiscardFailure(finalization.cacheClearFailure);
            }
        }
        if (exportReady && downloadPlan.retainCacheOnSuccess && !finalization.cacheDiscarded) {
            publishCacheSyncEvent({ type: "cache-saved", bookId, taskId: lock.taskId });
        }
    }
}

/**
 * 创建任务独立的取消意图和网络信号，discard 只可升级
 */
function createDownloadCancellation(): DownloadCancellationPort & { readonly mode: DownloadCancellationMode } {
    const controller = new AbortController();
    const listeners = new Set<(mode: DownloadCancellationMode) => void>();
    let requested = false;
    let mode: DownloadCancellationMode = "flush";
    return {
        signal: controller.signal,
        get mode() {
            return mode;
        },
        isCancellationRequested: () => requested,
        requestCancellation(next = "flush") {
            if (requested && (mode === "discard" || next !== "discard")) {
                return;
            }
            // 先固定意图再中止网络；缓存 writer 使用独立信号完成有界保存
            mode = next;
            requested = true;
            controller.abort();
            listeners.forEach((listener) => listener(mode));
        },
        subscribeCancellation(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}

// 下载核心的浏览器实现边界
// 任务数据显式传入，DOM、网络、缓存和锁实现在此装配
function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function recordInlineImageFailures(
    task: { index: number; title: string; url: string },
    failures: ImageProcessingFailure[],
    taskId: string
): void {
    // 插图故障只作为当前章节的附加诊断，不能影响下载核心的章节成功、补抓或导出终态
    failures.forEach((failure) => {
        recordBrowserDiagnosticFailure(
            {
                scope: "image",
                stage: failure.stage,
                code: failure.code,
                message: failure.message,
                imageFailureCount: failure.count,
                chapter: task
            },
            taskId
        );
    });
}

interface BrowserDownloadTask {
    lock: BookDownloadLock;
    chapters: Map<number, Chapter>;
    cancellation: DownloadCancellationPort & { readonly mode: DownloadCancellationMode };
    ui: DownloadUiPort;
}

const protectedChapterDetector = { isProtected: isProtectedChapterHtml };

// 解析正文并根据当前设置处理或移除图片
function createChapterProcessor(taskId: string): ChapterProcessorPort {
    const taskLog = (message: string) => {
        if (isCurrentDownload(taskId)) {
            log(message);
        }
    };
    return {
        normalizeCached: normalizeChapterMappingFont,
        async process(html, task, imageEnabled, signal) {
            const processed = await processParsedChapter(
                parseChapterHtml(html, task.title),
                task.index,
                imageEnabled,
                signal
            );
            if (!signal?.aborted) {
                recordInlineImageFailures(
                    task,
                    processed.imageFailures.map((failure) =>
                        "imageProcessingError" in processed
                            ? { ...failure, message: t("image.processingFailure") }
                            : failure
                    ),
                    taskId
                );
            }
            if ("imageProcessingError" in processed) {
                taskLog(
                    t("image.processingLog", {
                        count: processed.chapter.imageErrors || 0,
                        chapter: task.index + 1,
                        title: task.title,
                        detail: getErrorMessage(processed.imageProcessingError)
                    })
                );
            }
            return processed.chapter;
        }
    };
}

// 封面是可选资源，任何获取异常都降级为无封面导出
function createCoverFetcher(taskId: string): CoverFetcherPort {
    const taskLog = (message: string) => {
        if (isCurrentDownload(taskId)) {
            log(message);
        }
    };
    return {
        fetch(url, signal) {
            return fetchBookCover(
                url,
                (fact) => {
                    switch (fact.code) {
                        case "started":
                            taskLog(t("cover.start"));
                            break;
                        case "too-small":
                            taskLog(t("cover.tooSmall"));
                            break;
                        case "invalid-format":
                            taskLog(t("cover.invalidFormat"));
                            break;
                        case "completed":
                            taskLog(t("cover.completed"));
                            break;
                        case "skipped":
                            taskLog(t("cover.skipped", { detail: getErrorMessage(fact.error) }));
                            break;
                    }
                },
                signal
            );
        }
    };
}

const coverCache: CoverCacheRepository = {
    load: loadBookCover,
    put: putBookCoverForTask
};

// IndexedDB 适配层只接收本批发生变化的章节
const cache: ChapterCacheRepository = {
    putBatch: putBookCacheBatchForTask,
    finishForTask: finishBookCacheForTask,
    clearForTask: clearBookCacheForTask
};

/**
 * 创建本次下载使用的浏览器依赖
 */
function createDownloadDependencies(task: BrowserDownloadTask): DownloadDependencies {
    const concurrency = getConcurrency();
    const fallbackPageUrl = location.href;
    const startedAt = Date.now();
    const requestGate = new RequestGate();
    let taskStarted = false;
    const { lock: activeLock, chapters, cancellation } = task;
    const { ui } = task;
    const lock: BookLockService = {
        owns: () => ownsActiveBookDownloadLock(activeLock),
        shouldDiscardCache: () => shouldDiscardBookDownloadCache(activeLock)
    };
    const chapterFetcher = createChapterFetcher(requestGate);
    const protectedChapterAuth = createProtectedChapterAuth(fetchWithTimeout, requestGate);

    return {
        chapters,
        cancellation,
        ui,
        chapterFetcher,
        chapterProcessor: createChapterProcessor(activeLock.taskId),
        protectedChapterDetector,
        protectedChapterAuth,
        coverFetcher: createCoverFetcher(activeLock.taskId),
        coverCache,
        cache,
        lock,
        events: {
            emit(event) {
                // 页面会话只是核心快照的显示副本，不反向驱动下载状态
                if (isCurrentDownload(activeLock.taskId) && event.type === "task-started") {
                    taskStarted = true;
                    startRuntimeCacheSession(event.meta, event.taskId, event.bookChapterCount);
                } else if (
                    taskStarted &&
                    isCurrentDownload(activeLock.taskId) &&
                    (event.type === "snapshot-updated" || event.type === "phase-changed")
                ) {
                    const snapshot = event.snapshot;
                    updateRuntimeCacheSession(
                        {
                            completedCount: snapshot.completedCount,
                            bookChapterCount: chapters.size,
                            status:
                                snapshot.phase === "cancelled"
                                    ? "cancelled"
                                    : snapshot.phase === "export-ready"
                                      ? "export-ready"
                                      : "downloading",
                            hasExportData: snapshot.hasExportData
                        },
                        activeLock.taskId
                    );
                }
                recordBrowserDownloadEvent(activeLock.taskId, event);
            }
        },
        scheduler: {
            sleep,
            sleepWithAbort: (ms) => sleepWithAbort(ms, cancellation.signal),
            randomDelay: (minInclusive, maxInclusive) =>
                Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive,
            schedule: (delayMs, callback) => {
                const timer = window.setTimeout(callback, delayMs);
                return () => window.clearTimeout(timer);
            }
        },
        concurrency,
        fallbackPageUrl,
        startedAt,
        log: (message) => browserDiagnosticLog(message, activeLock.taskId, isCurrentDownload(activeLock.taskId))
    };
}

/**
 * 书籍下载收尾时的缓存清理结果
 */
interface BookDownloadFinalizationResult {
    cacheDiscarded: boolean;
    cacheClearFailure: StorageFailure | null;
}

/**
 * 处理缓存清除请求，并在所有退出路径停止心跳、释放锁
 */
async function finalizeBookDownloadTask(
    lock: BookDownloadLock,
    stopHeartbeat: () => void,
    logMessage?: (message: DownloadLog) => void
): Promise<BookDownloadFinalizationResult> {
    let cacheDiscarded = false;
    let cacheClearFailure: StorageFailure | null = null;
    try {
        // 远程“停止并清除”由锁携带意图，只有当前 writer 可以清除对应缓存
        if (await shouldDiscardBookDownloadCache(lock)) {
            try {
                cacheDiscarded = await clearBookCacheForTask(lock.bookId, lock.taskId);
                if (!cacheDiscarded) {
                    cacheClearFailure = toStorageFailure(createStorageError("ownership-lost", "clear"));
                    logMessage?.({
                        code: "cache-discard-failed",
                        params: {
                            reason: cacheClearFailure.reason,
                            operation: cacheClearFailure.operation,
                            detail: cacheClearFailure.params?.detail || cacheClearFailure.message
                        }
                    });
                }
            } catch (error) {
                const failure = normalizeStorageError(error, "clear");
                cacheClearFailure = toStorageFailure(failure);
                console.error("停止任务时清理缓存失败", failure);
                logMessage?.({
                    code: "cache-discard-failed",
                    params: {
                        reason: failure.reason,
                        operation: failure.operation,
                        detail: failure.params?.detail || failure.message
                    }
                });
            }
            if (cacheDiscarded) {
                clearRuntimeCacheSession(lock.bookId, lock.taskId);
            }
        }
    } finally {
        // 即使缓存清理失败也要停止心跳，否则其他页面会持续认为任务存活
        try {
            try {
                stopHeartbeat();
            } finally {
                await releaseBookDownloadLock(lock, { cacheDiscarded });
            }
        } finally {
            // 锁释放异常时仍清理当前页引用，避免后续流程误用旧锁
            releaseActiveDownload(lock.taskId);
        }
    }
    return { cacheDiscarded, cacheClearFailure };
}
