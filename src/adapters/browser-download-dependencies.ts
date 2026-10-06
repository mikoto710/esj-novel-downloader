import { runDownload } from "../download/run";
import type {
    BookLockService,
    ChapterCacheRepository,
    ChapterProcessorPort,
    CoverCacheRepository,
    CoverFetcherPort,
    DownloadDependencies,
    DownloadOptions,
    DownloadResult,
    DownloadCancellationPort,
    DownloadSnapshot,
    DownloadUiPort
} from "../download/contracts";
import { ownsActiveBookDownloadLock, shouldDiscardBookDownloadCache } from "../storage/book-lock";
import { getConcurrency } from "../storage/settings";
import { parseChapterHtml, processParsedChapter, createChapterFetcher } from "../site/chapter";
import { isCurrentDownload, startRuntimeCacheSession, updateRuntimeCacheSession } from "../core/state";
import {
    clearBookCacheForTask,
    finishBookCacheForTask,
    loadBookCover,
    putBookCacheBatchForTask,
    putBookCoverForTask
} from "../storage/cache/book-cache";
import type { DownloadCancellationMode } from "../types";
import type { BookDownloadLock } from "../storage/book-lock";
import type { Chapter } from "../content/model";
import {
    closeProtectedChapterPrompt,
    confirmMappingFontDownload,
    confirmIncompleteChapters,
    createDownloadPopup,
    promptProtectedChapterPassword,
    showMappingFontFailure,
    updateMappingFontWarning
} from "../ui/popups";
import { updateTrayText } from "../ui/tray";
import { fullCleanup } from "../utils/dom";
import { fetchBookCover, type ImageProcessingFailure } from "../site/images";
import { sleep, sleepWithAbort } from "../browser/timing";
import { log } from "../utils/log";
import { fetchWithTimeout } from "../browser/request";
import { normalizeChapterMappingFont } from "../content/mapping-font";
import {
    recordBrowserDownloadEvent,
    browserDiagnosticLog,
    recordBrowserDiagnosticFailure
} from "./browser-diagnostics";
import { showDownloadTerminalFailure } from "../ui/messages/download-terminal";
import { createProtectedChapterAuth, isProtectedChapterHtml } from "../site/protected-chapter";
import { RequestGate } from "../site/request-gate";
import { subscribeInterfaceLocaleChange, t } from "../ui/locale";

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

export interface BrowserDownloadTask {
    lock: BookDownloadLock;
    chapters: Map<number, Chapter>;
    cancellation: DownloadCancellationPort & { readonly mode: DownloadCancellationMode };
    originalTitle: string;
}

function updateDownloadStatus(status: string, originalTitle: string): void {
    const titleEl = document.querySelector("#esj-title") as HTMLElement | null;
    if (titleEl) {
        titleEl.textContent = "📘 " + status;
    }
    document.title = `[${status}] ${originalTitle}`;
    updateTrayText(status);
}

/**
 * 进度显示和语言订阅只跟随本次任务
 */
function createBrowserDownloadUi(task: BrowserDownloadTask): DownloadUiPort {
    const { originalTitle, cancellation } = task;
    const isCurrent = () => isCurrentDownload(task.lock.taskId);
    let lastDownloadSnapshot: DownloadSnapshot | null = null;
    let activeDownloadMode: "all" | "range" = "all";
    let cleaned = false;

    // 下载核心只发布快照，所有标题、进度条、托盘和弹窗更新在此落到 DOM
    const ui: DownloadUiPort = {
        prepare(selection) {
            if (!isCurrent()) {
                return;
            }
            activeDownloadMode = selection.mode;
            if (!document.querySelector("#esj-popup")) {
                createDownloadPopup(selection.mode, cancellation.requestCancellation, originalTitle);
            }
        },
        update(snapshot) {
            if (!isCurrent()) {
                return;
            }
            lastDownloadSnapshot = snapshot;
            if (snapshot.phase === "cancelling" || snapshot.phase === "cancelled") {
                const cancelled = snapshot.phase === "cancelled";
                const status = t(cancelled ? "download.status.stopped" : "download.status.stopping");
                const titleEl = document.querySelector("#esj-title") as HTMLElement | null;
                const cancelButton = document.querySelector("#esj-cancel") as HTMLButtonElement | null;
                if (titleEl) {
                    titleEl.textContent = "📘 " + status;
                }
                if (cancelButton) {
                    cancelButton.disabled = true;
                    cancelButton.textContent = cancelled
                        ? t("download.action.stopped")
                        : cancellation.mode === "discard"
                          ? t("download.action.stopping")
                          : t("download.action.saving");
                    cancelButton.style.backgroundColor = "#999";
                }
                updateTrayText(status);
                return;
            }
            const phaseStatus: Partial<Record<DownloadSnapshot["phase"], string>> = {
                preparing: t("download.status.initializing"),
                "restoring-cache":
                    snapshot.readyChapterCount > 0
                        ? t("download.status.validatingCache", { count: snapshot.readyChapterCount })
                        : t("download.status.preparingCache"),
                "flushing-cache": t("download.status.savingProgress", {
                    ready: snapshot.readyChapterCount,
                    total: snapshot.scheduledCount
                }),
                "checking-integrity": t("download.status.checkingIntegrity", {
                    ready: snapshot.readyChapterCount,
                    total: snapshot.scheduledCount
                }),
                "preparing-export": t("download.status.preparingExport", {
                    ready: snapshot.readyChapterCount,
                    total: snapshot.scheduledCount
                }),
                "export-ready": t("download.status.exportReady", {
                    ready: snapshot.readyChapterCount,
                    total: snapshot.scheduledCount
                })
            };
            const status = phaseStatus[snapshot.phase];
            if (status) {
                updateDownloadStatus(status, originalTitle);
                return;
            }
            if (
                snapshot.phase !== "downloading" ||
                snapshot.cancellationRequested ||
                (snapshot.readyChapterCount === 0 &&
                    snapshot.protectedPendingCount === 0 &&
                    snapshot.protectedDetectedCount === 0)
            ) {
                return;
            }
            const { readyChapterCount: count, scheduledCount: total, protectedPendingCount: pending } = snapshot;
            const downloadStatus =
                pending > 0
                    ? t(
                          activeDownloadMode === "range"
                              ? "download.status.runningRangeProtected"
                              : "download.status.runningProtected",
                          { ready: count, total, pending }
                      )
                    : t(activeDownloadMode === "range" ? "download.status.runningRange" : "download.status.running", {
                          ready: count,
                          total
                      });
            const progressEl = document.querySelector("#esj-progress") as HTMLElement | null;
            updateDownloadStatus(downloadStatus, originalTitle);
            document.title = `[${count}/${total}${pending > 0 ? t("download.status.protectedTitle", { pending }) : ""}] ${originalTitle}`;
            if (progressEl) {
                progressEl.style.width = (count / total) * 100 + "%";
            }
        },
        confirmMappingFontDownload,
        confirmIncompleteChapters,
        promptProtectedChapterPassword,
        closeProtectedChapterPrompt: () => {
            if (isCurrent()) {
                closeProtectedChapterPrompt();
            }
        },
        updateMappingFontWarning(summary) {
            if (isCurrent()) {
                updateMappingFontWarning(summary);
            }
        },
        showMappingFontFailure(failures) {
            if (isCurrent()) {
                showMappingFontFailure(failures);
            }
        },
        showTerminalFailure(failure) {
            if (isCurrent()) {
                showDownloadTerminalFailure(failure);
            }
        },
        cleanup() {
            if (cleaned) {
                return;
            }
            cleaned = true;
            unsubscribeLocale();
            if (isCurrent()) {
                fullCleanup(originalTitle);
            }
        }
    };

    const unsubscribeLocale = subscribeInterfaceLocaleChange(() => {
        if (isCurrent() && lastDownloadSnapshot && document.querySelector("#esj-popup")) {
            ui.update(lastDownloadSnapshot);
        }
    });
    return ui;
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
export function createBrowserDownloadDependencies(task: BrowserDownloadTask): DownloadDependencies {
    const concurrency = getConcurrency();
    const fallbackPageUrl = location.href;
    const startedAt = Date.now();
    const requestGate = new RequestGate();
    let taskStarted = false;
    const { lock: activeLock, chapters, cancellation } = task;
    const ui = createBrowserDownloadUi(task);
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
 * 装配本次任务的浏览器能力并返回下载结果
 */
export async function batchDownload(options: DownloadOptions, task: BrowserDownloadTask): Promise<DownloadResult> {
    const dependencies = createBrowserDownloadDependencies(task);
    try {
        return await runDownload(options, dependencies);
    } finally {
        // 核心尚未进入 try 时也可能拒绝输入，浏览器订阅仍需关闭
        dependencies.ui.cleanup();
    }
}
