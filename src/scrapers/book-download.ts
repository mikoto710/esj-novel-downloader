import type { DownloadSelection, DownloadTask } from "../core/download/contracts";
import type { SourcePageType } from "../types";
import type { LocaleKey } from "../core/locale";
import type { parseBookMetadata } from "../core/parser";
import { abortActiveDownload, resetAbortController, setAbortFlag, state } from "../core/state";
import {
    acquireBookDownloadLock,
    markBookDownloadRunning,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../core/book-lock";
import { claimBookCache, previewBookCache, type BookCachePreviewResult } from "../core/cache/book-cache";
import { publishCacheSyncEvent } from "../core/cache/sync";
import { getImageDownloadSetting } from "../core/config";
import { batchDownload } from "../adapters/batch-download";
import { selectDownloadTasks } from "../core/download/selection";
import { finalizeBookDownloadTask } from "../core/download/task-finalizer";
import { normalizeStorageError, StorageError, toStorageFailure } from "../core/cache/storage-error";
import { fullCleanup } from "../utils/dom";
import { createDownloadPopup, showBookDownloadInProgressPopup, showFormatChoice } from "../ui/popups";
import { createDownloadSelectionPopup } from "../ui/dialogs/download-selection";
import { showMessagePopup } from "../ui/dialogs/message";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../ui/messages/download-terminal";
import { formatStorageFailure } from "../ui/messages/storage-failure";
import { t } from "../ui/locale";
import {
    browserDiagnosticLog as log,
    finishBrowserDiagnosticSession,
    recordBrowserDiagnosticFailure,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../adapters/browser-diagnostics";

type BookSourcePageType = Extract<SourcePageType, "detail" | "forum">;
type ParsedBookMetadata = ReturnType<typeof parseBookMetadata>;

export interface PreparedBook {
    tasks: DownloadTask[];
    meta: ParsedBookMetadata;
    pageUrl: string;
}

export class BookPreflightError extends Error {
    constructor(
        readonly code: "chapter-list-missing" | "detail-fetch-failed",
        readonly stage: "chapter-list" | "book-metadata",
        options?: ErrorOptions
    ) {
        super(code, options);
        this.name = "BookPreflightError";
    }
}

interface RunBookDownloadOptions {
    bookId: string;
    sourcePageType: BookSourcePageType;
    pageTitle: string;
    loadPlan(): Promise<PreparedBook>;
}

/**
 * 先选择下载范围，再取得锁并执行同一任务流程
 */
export async function runBookDownload(options: RunBookDownloadOptions): Promise<void> {
    const { bookId, sourcePageType } = options;
    state.originalTitle = options.pageTitle;
    const imageEnabled = getImageDownloadSetting();
    const previousExport = state.cachedData;
    let plan: PreparedBook | undefined;
    let preview: BookCachePreviewResult | undefined;
    let preparationErrorKey: LocaleKey | undefined;

    try {
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
                stage: failure instanceof BookPreflightError ? failure.stage : "cache-read",
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
    selection: DownloadSelection,
    imageEnabled: boolean,
    allowInvalidation: boolean
): Promise<BookCachePreviewResult | undefined> {
    const { bookId, sourcePageType } = options;
    const selectedTasks = selectDownloadTasks(plan.tasks, selection);
    const lockResult = await acquireBookDownloadLock(bookId, sourcePageType);
    if (!lockResult.acquired) {
        fullCleanup(state.originalTitle);
        showBookDownloadInProgressPopup(lockResult.lock);
        return;
    }

    const lock = lockResult.lock;
    state.activeBookLock = lock;
    let stopHeartbeat: () => void = () => undefined;
    let diagnosticStarted = false;
    let downloadStarted = false;
    let exportReady = false;

    try {
        setAbortFlag(false);
        resetAbortController();
        stopHeartbeat = startBookDownloadLockHeartbeat(lock, abortActiveDownload);
        createDownloadPopup(selection.mode);
        startBrowserDiagnosticSession(
            {
                taskId: lock.taskId,
                bookId,
                bookTitle: plan.meta.rawBookName || plan.meta.bookName,
                pageUrl: plan.pageUrl,
                sourcePageType,
                totalChapters: selectedTasks.length,
                selection: {
                    mode: selection.mode,
                    sourceTotalChapters: selection.sourceTotalChapters,
                    startChapter: selection.startIndex + 1,
                    endChapter: selection.endIndex + 1
                },
                imageEnabled
            },
            { observePageClose: true }
        );
        diagnosticStarted = true;
        log(t("page.cachePreparing"));
        const claimedCache = await claimBookCache(bookId, lock.taskId, imageEnabled, state.abortController?.signal, {
            allowInvalidation
        });
        if (claimedCache.status === "needs-confirmation") {
            fullCleanup(state.originalTitle);
            return claimedCache;
        }
        state.globalChaptersMap = claimedCache.map || new Map();
        if (claimedCache.invalidatedCount > 0) {
            log(
                claimedCache.compatibility === "unknown"
                    ? t("page.cacheInvalidLegacyImage", { count: claimedCache.invalidatedCount })
                    : t("page.cacheInvalidImageMismatch", { count: claimedCache.invalidatedCount })
            );
        }
        if (state.abortFlag) {
            fullCleanup(state.originalTitle);
            return;
        }

        await updateBookDownloadLockTitle(lock, plan.meta.rawBookName || plan.meta.bookName);
        if (state.abortFlag || !(await markBookDownloadRunning(lock))) {
            if (!state.abortFlag) {
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
            fullCleanup(state.originalTitle);
            if (!state.abortFlag) {
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
        const result = await batchDownload(downloadOptions);
        if (result.status === "ready") {
            state.cachedData = result.data;
            exportReady = true;
            showFormatChoice(result.data);
        }
    } catch (error) {
        const details = error instanceof Error ? error : new Error(String(error));
        if (state.abortFlag || details.name === "AbortError" || details.message === "User Aborted") {
            fullCleanup(state.originalTitle);
            return;
        }
        console.error(error);
        if (!downloadStarted) {
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
            fullCleanup(state.originalTitle);
            showMessagePopup({
                tone: "error",
                title: t("page.startFailed.title"),
                message: error instanceof StorageError ? displayMessage : t("page.startFailed.message"),
                ...(error instanceof StorageError ? {} : { details: details.message })
            });
        }
    } finally {
        if (diagnosticStarted) {
            finishBrowserDiagnosticSession(lock.taskId, state.abortFlag ? "cancelled" : "failed");
        }
        const finalization = await finalizeBookDownloadTask(lock, stopHeartbeat, log);
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
            showCacheDiscardFailure(finalization.cacheClearFailure);
        }
        if (exportReady && selection.mode === "range" && !finalization.cacheDiscarded) {
            publishCacheSyncEvent({ type: "cache-saved", bookId, taskId: lock.taskId });
        }
    }
}
