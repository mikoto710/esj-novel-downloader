import {
    browserDiagnosticLog,
    finishBrowserDiagnosticSession,
    recordBrowserDiagnosticFailure,
    recordBrowserDownloadEvent,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../diagnostics/runtime";
import { sleep, sleepWithAbort } from "../browser/timing";
import { normalizeChapterMappingFont } from "../content/mapping-font";
import type { LocaleKey } from "../locale/catalog";
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
    DownloadEvent,
    DownloadResult,
    DownloadUiPort
} from "../download/contracts";
import type { ChapterSelection } from "../download/plan";
import { createDownloadPlan, selectDownloadTasks } from "../download/plan";
import { createCancellationDeadline, type CancellationDeadline } from "../download/cancellation-deadline";
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
import { createChapterCacheSources, type ChapterCacheSources } from "../storage/cache/chapter-source";
import { publishCacheSyncEvent } from "../storage/cache/sync";
import { getChapterRequestMode, getConcurrency, getImageDownloadSetting } from "../storage/settings";
import type { DownloadCancellationMode } from "../download/contracts";
import type { SourcePageType } from "../content/model";
import { createDownloadSelectionPopup } from "../ui/dialogs/download-selection";
import { showMessagePopup } from "../ui/dialogs/message";
import { createDownloadView } from "../ui/download-view";
import { t } from "../ui/locale";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../ui/messages/download-terminal";
import { formatStorageFailure } from "../ui/messages/storage-failure";
import { showBookDownloadInProgressPopup, showFormatChoice, showMappingFontFailure } from "../ui/popups";
import { fullCleanup } from "../ui/dom";
import { log } from "../ui/log-view";
import type { CachedData } from "./export";

type BookSourcePageType = Extract<SourcePageType, "detail" | "forum">;

type DownloadPhaseEvent = Extract<DownloadEvent, { type: "phase-changed" }>;

interface RunBookDownloadOptions {
    bookId: string;
    sourcePageType: BookSourcePageType;
    pageTitle: string;
    loadPlan(signal?: AbortSignal): Promise<PreparedBook>;
}

/**
 * 管理书籍准备与章节选择，确认后取得锁并进入正式下载
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

    const initialPreview = {
        tasks: [],
        cachedIndexes: new Set<number>(),
        cacheWillBeInvalidated: false,
        cacheCount: 0
    };
    const viewOptions = {
        imageEnabled,
        hasExistingExport: Boolean(previousExport),
        ...(previousExport ? { existingSelection: previousExport.exportContext.selection } : {})
    };
    const preparation = new AbortController();
    const popup = createDownloadSelectionPopup({
        ...initialPreview,
        ...viewOptions,
        preparationStage: "checking-task"
    });
    const isPreparing = () => !preparation.signal.aborted && !popup.closed;

    // 将本次预检事实转换为选择窗口预览，旧导出和插图设置保持创建时的值
    function selectionPreview(initialSelection?: ChapterSelection) {
        return {
            tasks: plan?.tasks || [],
            ...(plan ? { directory: plan.directory, bookTitle: plan.meta.rawBookName || plan.meta.bookName } : {}),
            cachedIndexes: new Set(preview?.indexes || []),
            cacheWillBeInvalidated: Boolean(preview && preview.size > 0 && preview.compatibility !== "compatible"),
            cacheCount: preview?.size || 0,
            ...(initialSelection ? { initialSelection } : {}),
            ...(preparationErrorKey ? { preparationErrorKey } : {})
        };
    }

    // 只读准备目录与缓存，窗口结束后不再启动读取、展示冲突或记录失败
    async function prepare(): Promise<void> {
        try {
            const conflictingLock = await getConflictingBookDownloadLock(bookId);
            if (!isPreparing()) {
                return;
            }

            // 预检只提前提示，确认后的原子获取仍负责互斥
            if (conflictingLock) {
                popup.close();
                showBookDownloadInProgressPopup(conflictingLock);
                return;
            }

            storageStage = "cache-read";
            popup.showPreparing("reading-book");
            plan = await options.loadPlan(preparation.signal).catch((error: unknown) => {
                if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError") {
                    throw error;
                }
                throw error instanceof BookPreflightError
                    ? error
                    : new BookPreflightError("detail-fetch-failed", "book-metadata", { cause: error });
            });
            if (!isPreparing()) {
                return;
            }
            if (plan.tasks.length === 0) {
                throw new BookPreflightError("chapter-list-missing", "chapter-list");
            }
            popup.showPreparing("checking-cache");
            preview = await previewBookCache(
                bookId,
                imageEnabled,
                createChapterCacheSources(plan.tasks, location.origin)
            );
            if (isPreparing()) {
                popup.showReady(selectionPreview());
            }
        } catch (error) {
            if (!isPreparing()) {
                return;
            }
            const failure = error instanceof BookPreflightError ? error : normalizeStorageError(error, "read");
            preparationErrorKey =
                failure instanceof BookPreflightError
                    ? failure.code === "chapter-list-missing"
                        ? "page.chaptersMissing.message"
                        : failure.code === "detail-fetch-timeout"
                          ? "page.detailTimeout.message"
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
            popup.showReady(selectionPreview());
        }
    }

    // 选择不等待预检完成，用户取消或打开旧结果都能及时结束入口等待
    void prepare().catch((error) => {
        if (isPreparing()) {
            console.error(error);
            popup.close();
        }
    });
    let decision: Awaited<typeof popup.decision>;
    try {
        decision = await popup.decision;
    } finally {
        preparation.abort();
    }
    while (true) {
        if (decision.action === "open-existing") {
            if (previousExport) {
                showFormatChoice(previousExport);
            }
            return;
        }
        if (decision.action === "cancel" || !plan || !preview || preparationErrorKey) {
            return;
        }
        const initialSelection = decision.selection;
        const invalidatesCache = selectionPreview().cacheWillBeInvalidated;
        // 仅未确认的缓存失效返回新预览；释放锁后再让用户选择
        const latest = await executeBookDownload(
            options,
            plan,
            initialSelection,
            imageEnabled,
            invalidatesCache,
            decision.filename
        );
        if (!latest) {
            return;
        }
        preview = latest;
        decision = await createDownloadSelectionPopup({
            ...selectionPreview(initialSelection),
            initialFilename: decision.filename ?? "",
            ...viewOptions
        }).decision;
    }
}

// 固定选择后取得锁：启动视图和心跳 → 原子认领 → 装配执行 → 发布结果；finally 负责全部出口
async function executeBookDownload(
    options: RunBookDownloadOptions,
    plan: PreparedBook,
    inputSelection: ChapterSelection,
    imageEnabled: boolean,
    allowInvalidation: boolean,
    filename?: string
): Promise<BookCachePreviewResult | undefined> {
    const { bookId, sourcePageType } = options;
    const downloadPlan = createDownloadPlan({
        tasks: selectDownloadTasks(plan.tasks, inputSelection),
        selection: inputSelection
    });
    const selection = downloadPlan.selection;
    const selectedTasks = [...downloadPlan.tasks];
    const chapterSources = createChapterCacheSources(selectedTasks, location.origin);
    const cancellation = createDownloadCancellation();
    const lockResult = await acquireBookDownloadLock(bookId, sourcePageType);
    if (!lockResult.acquired) {
        fullCleanup(options.pageTitle);
        showBookDownloadInProgressPopup(lockResult.lock);
        return;
    }

    const lock = lockResult.lock;
    const deadline = createCancellationDeadline(cancellation, scheduleDownloadCallback);
    const log = (message: Parameters<typeof browserDiagnosticLog>[0]) =>
        browserDiagnosticLog(message, lock.taskId, isCurrentDownload(lock.taskId));
    let ui: ReturnType<typeof createDownloadView> | undefined;
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
    let exportReadyDiagnostic: DownloadPhaseEvent | undefined;
    let downloadStarted = false;
    let result: DownloadResult | undefined;

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
        const claimedCache = await deadline.wait(
            claimBookCache(bookId, lock.taskId, imageEnabled, cancellation.signal, {
                allowInvalidation,
                chapterSources
            })
        );
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

        await deadline.wait(updateBookDownloadLockTitle(lock, plan.meta.rawBookName || plan.meta.bookName));
        if (cancellation.isCancellationRequested() || !(await deadline.wait(markBookDownloadRunning(lock)))) {
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

        // 缓存已认领且锁已进入运行态，才固定核心输入并读取装配设置
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
            initialChapters: chapters,
            selection
        } as const;
        updateBrowserDiagnosticSession(downloadOptions);
        downloadStarted = true;
        const dependencies = createDownloadDependencies({
            lock,
            cancellation,
            ui,
            chapterSources,
            deferExportReadyDiagnostic(event) {
                exportReadyDiagnostic = event;
            }
        });
        result = await runDownload(downloadOptions, dependencies);
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
        const finalization = await finalizeBookDownloadTask(lock, stopHeartbeat, cancellation, deadline);
        deadline.dispose();
        if (deadline.signal.aborted && result?.status !== "failed") {
            result = {
                status: "cancelled",
                outcome: "save-timed-out",
                storageFailure: toStorageFailure(deadline.signal.reason)
            };
        }
        if (diagnosticStarted) {
            if (exportReadyDiagnostic && result?.status === "ready") {
                // 锁释放还可能接到远程清理或发现所有权丢失，终态与最终交付的结果一致
                const current = finalization.ownershipLost
                    ? "failed"
                    : finalization.discardRequested
                      ? "cancelled"
                      : "export-ready";
                const { snapshot } = exportReadyDiagnostic;
                const hasExportData = current === "export-ready";
                recordBrowserDownloadEvent(lock.taskId, {
                    ...exportReadyDiagnostic,
                    current,
                    snapshot: {
                        ...snapshot,
                        phase: current,
                        hasExportData,
                        storageFailure: hasExportData ? snapshot.storageFailure : finalization.failure
                    }
                });
            } else {
                // 补齐提前退出的诊断，保留核心已经记录的失败或取消阶段
                finishBrowserDiagnosticSession(
                    lock.taskId,
                    cancellation.isCancellationRequested() ? "cancelled" : "failed"
                );
            }
        }
        const wasCurrent = isCurrentDownload(lock.taskId);
        let data: CachedData | undefined;
        try {
            cleanup();
            if (finalization.discardRequested || finalization.ownershipLost || result?.status === "failed") {
                clearRuntimeCacheSession(bookId, lock.taskId);
            } else if (wasCurrent && result?.status === "ready") {
                data = filename ? { ...result.data, exportFilename: filename } : result.data;
                publishCachedExport(data, lock.taskId);
            }
        } finally {
            releaseActiveDownload(lock.taskId);
        }
        const cacheCleanupFailure = result?.status === "ready" ? result.cacheCleanupFailure : undefined;
        if (cacheCleanupFailure) {
            recordBrowserDiagnosticFailure(
                {
                    scope: "storage",
                    stage: "cache-clear",
                    code: cacheCleanupFailure.reason,
                    message: cacheCleanupFailure.message
                },
                lock.taskId
            );
        }
        if (wasCurrent && !state.activeDownload) {
            if (result?.status === "failed") {
                if (result.failure.kind === "mapping-font") {
                    showMappingFontFailure(result.failure.failures);
                } else {
                    showDownloadTerminalFailure(result.failure);
                }
            } else if (finalization.ownershipLost) {
                showDownloadTerminalFailure({
                    kind: "cancellation",
                    outcome: "ownership-lost",
                    storageFailure: finalization.failure
                });
            } else if (result?.status === "cancelled" && result.outcome !== "saved" && result.outcome !== "discarded") {
                showDownloadTerminalFailure({
                    kind: "cancellation",
                    outcome: result.outcome,
                    storageFailure: result.storageFailure
                });
            } else {
                if (data) {
                    showFormatChoice(data);
                }
                const warning = finalization.failure ?? cacheCleanupFailure;
                if (warning && finalization.discardRequested && warning.operation === "clear") {
                    showCacheDiscardFailure(warning);
                } else if (warning) {
                    showMessagePopup({
                        tone: "warning",
                        title: t("download.terminal.cleanupWarning.title"),
                        message: t("download.terminal.cleanupWarning.message"),
                        details: formatStorageFailure(warning)
                    });
                }
            }
        }
        if (data && downloadPlan.retainCacheOnSuccess) {
            publishCacheSyncEvent({ type: "cache-saved", bookId, taskId: lock.taskId });
        }
    }
}

// 书籍下载收尾时的缓存清理结果
interface BookDownloadFinalizationResult {
    discardRequested: boolean;
    ownershipLost: boolean;
    failure: StorageFailure | null;
}

// 处理缓存清除请求，并在所有退出路径停止心跳、释放锁
async function finalizeBookDownloadTask(
    lock: BookDownloadLock,
    stopHeartbeat: () => void,
    cancellation: DownloadCancellationPort,
    deadline: CancellationDeadline
): Promise<BookDownloadFinalizationResult> {
    const result: BookDownloadFinalizationResult = {
        discardRequested: cancellation.mode === "discard",
        ownershipLost: false,
        failure: null
    };

    function recordFailure(error: unknown, operation: StorageFailure["operation"], stage: string): void {
        const failure = toStorageFailure(normalizeStorageError(error, operation));
        result.failure ??= failure;
        recordBrowserDiagnosticFailure(
            { scope: "storage", stage, code: failure.reason, message: failure.message },
            lock.taskId
        );
    }

    try {
        // 未处理的远程清理意图与普通释放在锁事务内结算
        // 已排队的普通释放仍只认旧任务 ID，允许在界面超时退出后完成
        let releaseResult = result.discardRequested
            ? "discard-requested"
            : await deadline.wait(releaseBookDownloadLock(lock));
        result.discardRequested = releaseResult === "discard-requested";
        if (result.discardRequested) {
            let cacheDiscarded = false;
            try {
                deadline.signal.throwIfAborted();
                cacheDiscarded = await deadline.wait(clearBookCacheForTask(lock.bookId, lock.taskId, deadline.signal));
                if (!cacheDiscarded) {
                    throw createStorageError("ownership-lost", "clear");
                }
            } catch (error) {
                if (error === deadline.signal.reason) {
                    throw error;
                }
                recordFailure(error, "clear", "cache-discard");
            }
            releaseResult = await deadline.wait(releaseBookDownloadLock(lock, { cacheDiscarded }));
        }
        if (releaseResult === "ownership-lost") {
            result.ownershipLost = true;
            recordFailure(createStorageError("ownership-lost", "write"), "write", "lock-release");
        }
    } catch (error) {
        recordFailure(error, "write", "lock-release");
    }
    try {
        stopHeartbeat();
    } catch (error) {
        recordFailure(error, "write", "lock-heartbeat");
    }
    return result;
}

// 创建任务独立的取消意图和网络信号，discard 只可升级
function createDownloadCancellation(): DownloadCancellationPort {
    const controller = new AbortController();
    const listeners = new Set<(mode: DownloadCancellationMode) => void>();
    let requestedAt: number | null = null;
    let mode: DownloadCancellationMode = "flush";
    return {
        signal: controller.signal,
        get mode() {
            return mode;
        },
        get requestedAt() {
            return requestedAt;
        },
        isCancellationRequested: () => requestedAt !== null,
        requestCancellation(next = "flush") {
            if (requestedAt !== null && (mode === "discard" || next !== "discard")) {
                return;
            }

            // 先固定意图再中止网络；缓存 writer 使用独立信号完成有界保存
            mode = next;
            requestedAt ??= Date.now();
            controller.abort();
            listeners.forEach((listener) => listener(mode));
        },
        subscribeCancellation(listener) {
            listeners.add(listener);
            if (requestedAt !== null) {
                listener(mode);
            }
            return () => listeners.delete(listener);
        }
    };
}

function scheduleDownloadCallback(delayMs: number, callback: () => void): () => void {
    const timer = window.setTimeout(callback, delayMs);
    return () => window.clearTimeout(timer);
}

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
    cancellation: DownloadCancellationPort;
    ui: DownloadUiPort;
    chapterSources: ChapterCacheSources;
    deferExportReadyDiagnostic(event: DownloadPhaseEvent): void;
}

const protectedChapterDetector = { isProtected: isProtectedChapterHtml };

// 创建绑定本任务身份的正文处理端口，插图开关由任务固定输入
function createChapterProcessor(taskId: string): ChapterProcessorPort {
    const taskLog = (message: string) => {
        if (isCurrentDownload(taskId)) {
            log(message);
        }
    };
    const processChapterHtml: ChapterProcessorPort["process"] = async (html, task, imageEnabled, signal) => {
        const parsed = parseChapterHtml(html, task.title);
        if (parsed.pageFailure) {
            return { pageFailure: parsed.pageFailure };
        }
        const processed = await processParsedChapter(parsed, task.index, imageEnabled, signal);
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
    };
    return { normalizeCached: normalizeChapterMappingFont, process: processChapterHtml };
}

// 创建绑定本任务身份的封面端口，获取异常降级为无封面
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

// 装配本任务的站点、浏览器、存储和视图能力，保持原任务身份
function createDownloadDependencies(task: BrowserDownloadTask): DownloadDependencies {
    const concurrency = getConcurrency();
    const fallbackPageUrl = location.href;
    const startedAt = Date.now();
    const requestGate = new RequestGate();
    let taskStarted = false;
    const { lock: activeLock, cancellation, chapterSources } = task;
    const cache: ChapterCacheRepository = {
        putBatch: (bookId, taskId, entries, meta, signal) =>
            putBookCacheBatchForTask(bookId, taskId, entries, meta, signal, chapterSources),
        finishForTask: finishBookCacheForTask,
        clearForTask: clearBookCacheForTask
    };
    const { ui } = task;
    const lock: BookLockService = {
        owns: () => ownsActiveBookDownloadLock(activeLock),
        shouldDiscardCache: () => shouldDiscardBookDownloadCache(activeLock)
    };
    const chapterFetcher = createChapterFetcher(requestGate, getChapterRequestMode() === "fetch");
    const protectedChapterAuth = createProtectedChapterAuth(requestGate);

    function observeDownloadEvent(event: DownloadEvent): void {
        try {
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
                        bookChapterCount: snapshot.bookChapterCount,
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
        } catch {
            // 摘要观察失败不阻断诊断
        }
        try {
            if (event.type === "phase-changed" && event.current === "export-ready") {
                task.deferExportReadyDiagnostic(event);
            } else {
                recordBrowserDownloadEvent(activeLock.taskId, event);
            }
        } catch {
            // 诊断观察失败不反向影响下载
        }
    }

    return {
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
        events: { emit: observeDownloadEvent },
        scheduler: {
            sleep,
            sleepWithAbort,
            randomDelay: (minInclusive, maxInclusive) =>
                Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive,
            schedule: scheduleDownloadCallback
        },
        concurrency,
        fallbackPageUrl,
        startedAt,
        log: (message) => browserDiagnosticLog(message, activeLock.taskId, isCurrentDownload(activeLock.taskId))
    };
}
