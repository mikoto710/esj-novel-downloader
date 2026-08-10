import type { DownloadTask } from "../core/download/contracts";
import type { SourcePageType } from "../types";
import type { parseBookMetadata } from "../core/parser";
import { abortActiveDownload, resetAbortController, setAbortFlag, state } from "../core/state";
import {
    acquireBookDownloadLock,
    getConflictingBookDownloadLock,
    markBookDownloadRunning,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../core/book-lock";
import { claimBookCache, loadBookCache } from "../core/cache/book-cache";
import { evaluateImageCacheCompatibility } from "../core/cache/image-cache-compatibility";
import { publishCacheSyncEvent } from "../core/cache/sync";
import { getImageDownloadSetting } from "../core/config";
import { batchDownload } from "../core/download/batch-download";
import { selectDownloadTasks } from "../core/download/selection";
import { finalizeBookDownloadTask } from "../core/download/task-finalizer";
import { normalizeStorageError, StorageError, toStorageFailure } from "../core/cache/storage-error";
import { fullCleanup } from "../utils/dom";
import { createDownloadPopup, showBookDownloadInProgressPopup, showFormatChoice } from "../ui/popups";
import { createRangeSelectionPopup } from "../ui/dialogs/range-selection";
import { showMessagePopup } from "../ui/dialogs/message";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../ui/download-terminal-notices";
import { formatStorageFailure } from "../ui/storage-failure-messages";
import { t } from "../ui/locale";
import {
    browserDiagnosticLog as log,
    finishBrowserDiagnosticSession,
    isBrowserDiagnosticSessionActive,
    recordBrowserDiagnosticFailure,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../adapters/browser-diagnostics";

type RangeSourcePageType = Extract<SourcePageType, "detail" | "forum">;
type ParsedBookMetadata = ReturnType<typeof parseBookMetadata>;

export interface PreparedRangeBook {
    tasks: DownloadTask[];
    meta: ParsedBookMetadata;
    pageUrl: string;
}

export class RangePreflightError extends Error {
    constructor(
        readonly code: "chapter-list-missing" | "detail-fetch-failed",
        readonly stage: "chapter-list" | "book-metadata",
        options?: ErrorOptions
    ) {
        super(code, options);
        this.name = "RangePreflightError";
    }
}

interface RunRangeDownloadOptions {
    bookId: string;
    sourcePageType: RangeSourcePageType;
    pageTitle: string;
    loadPlan(): Promise<PreparedRangeBook>;
}

function showPreflightFailure(error: RangePreflightError): void {
    showMessagePopup({
        tone: error.code === "chapter-list-missing" ? "warning" : "error",
        title: t(error.code === "chapter-list-missing" ? "page.chaptersMissing.title" : "page.detailFailed.title"),
        message: t(error.code === "chapter-list-missing" ? "page.chaptersMissing.message" : "page.detailFailed.message")
    });
}

/**
 * 在完整目录已可取得的页面上编排范围选择、锁、缓存认领和统一收尾
 */
export async function runRangeDownload(options: RunRangeDownloadOptions): Promise<void> {
    const { bookId, sourcePageType } = options;
    state.originalTitle = options.pageTitle;

    const conflictingLock = await getConflictingBookDownloadLock(bookId);
    if (conflictingLock) {
        showBookDownloadInProgressPopup(conflictingLock);
        return;
    }

    const imageEnabled = getImageDownloadSetting();
    let cacheResult;
    try {
        cacheResult = await loadBookCache(bookId);
    } catch (error) {
        const failure = normalizeStorageError(error, "read");
        const displayMessage = formatStorageFailure(toStorageFailure(failure));
        console.error(failure);
        log(t("page.cacheReadFailed", { detail: displayMessage }));
        recordBrowserPreflightDiagnosticFailure({
            bookId,
            bookTitle: options.pageTitle,
            pageUrl: location.href,
            sourcePageType,
            imageEnabled,
            failure: {
                scope: "storage",
                stage: "cache-read",
                code: failure.reason,
                message: failure.message
            }
        });
        showMessagePopup({
            tone: "error",
            title: t("page.cacheUnavailable.title"),
            message: t("page.cacheUnavailable.message")
        });
        return;
    }

    let plan: PreparedRangeBook;
    try {
        plan = await options.loadPlan();
        if (plan.tasks.length === 0) {
            throw new RangePreflightError("chapter-list-missing", "chapter-list");
        }
    } catch (error) {
        const preflightError =
            error instanceof RangePreflightError
                ? error
                : new RangePreflightError("detail-fetch-failed", "book-metadata", { cause: error });
        recordBrowserPreflightDiagnosticFailure({
            bookId,
            bookTitle: options.pageTitle,
            pageUrl: location.href,
            sourcePageType,
            totalChapters: 0,
            imageEnabled,
            failure: {
                scope: "page",
                stage: preflightError.stage,
                code: preflightError.code,
                message: preflightError.message
            }
        });
        showPreflightFailure(preflightError);
        return;
    }

    state.globalChaptersMap = cacheResult.map || new Map();
    const compatibility = evaluateImageCacheCompatibility(cacheResult.meta?.imageEnabled, imageEnabled);
    const decision = await createRangeSelectionPopup({
        tasks: plan.tasks,
        cachedIndexes: new Set(state.globalChaptersMap.keys()),
        cacheWillBeInvalidated: cacheResult.size > 0 && compatibility !== "compatible",
        hasExistingRange: state.cachedData?.exportContext?.selection?.mode === "range"
    });
    if (decision.action === "open-existing") {
        showFormatChoice();
        return;
    }
    if (decision.action === "cancel") {
        return;
    }
    const selection = decision.selection;
    const selectedTasks = selectDownloadTasks(plan.tasks, selection);

    const lockResult = await acquireBookDownloadLock(bookId, sourcePageType);
    if (!lockResult.acquired) {
        fullCleanup(state.originalTitle);
        showBookDownloadInProgressPopup(lockResult.lock);
        return;
    }

    const lock = lockResult.lock;
    state.activeBookLock = lock;
    const previousExport = state.cachedData;
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
        const claimedCache = await claimBookCache(bookId, lock.taskId, imageEnabled, state.abortController?.signal);
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
        await batchDownload(downloadOptions);
        exportReady =
            state.cachedData !== previousExport && state.cachedData?.exportContext?.selection?.mode !== undefined;
    } catch (error) {
        const details = error instanceof Error ? error : new Error(String(error));
        if (state.abortFlag || details.name === "AbortError" || details.message === "User Aborted") {
            fullCleanup(state.originalTitle);
            return;
        }
        console.error(error);
        if (!downloadStarted && isBrowserDiagnosticSessionActive(lock.taskId)) {
            recordBrowserDiagnosticFailure(
                {
                    scope: error instanceof StorageError ? "storage" : "page",
                    stage: `${sourcePageType}-range-page`,
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
