import { abortActiveDownload, state, setAbortFlag, resetAbortController } from "../core/state";
import {
    acquireBookDownloadLock,
    getConflictingBookDownloadLock,
    markBookDownloadRunning,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../core/book-lock";
import { fullCleanup } from "../utils/dom";
import { createConfirmPopup, createDownloadPopup, showBookDownloadInProgressPopup } from "../ui/popups";
import { showMessagePopup } from "../ui/message-popup";
import { batchDownload } from "../core/download/batch-download";
import type { DownloadTask } from "../core/download/contracts";
import { parseBookMetadata } from "../core/parser";
import { claimBookCache, loadBookCache } from "../core/cache/book-cache";
import { finalizeBookDownloadTask } from "../core/download/task-finalizer";
import { normalizeStorageError, StorageError } from "../core/cache/storage-error";
import { getImageDownloadSetting } from "../core/config";
import { getImageCacheConfirmHint } from "../ui/image-cache-compatibility";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../ui/download-terminal-notices";
import {
    browserDiagnosticLog as log,
    finishBrowserDiagnosticSession,
    isBrowserDiagnosticSessionActive,
    recordBrowserDiagnosticFailure,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../adapters/browser-diagnostics";

function getBookId(): string {
    const match = location.href.match(/\/detail\/(\d+)/);
    return match ? match[1] : "unknown";
}

/**
 * 解析详情页的章节列表并启动下载
 */
export async function scrapeDetail(): Promise<void> {
    const bookId = getBookId();
    if (bookId === "unknown") {
        log("无法解析书籍 ID，已取消全本下载任务。");
        return;
    }

    state.originalTitle = document.title;

    const conflictingLock = await getConflictingBookDownloadLock(bookId);
    if (conflictingLock) {
        showBookDownloadInProgressPopup(conflictingLock);
        return;
    }

    // 提前加载缓存
    let cacheResult;
    try {
        cacheResult = await loadBookCache(bookId);
    } catch (error) {
        const failure = normalizeStorageError(error, "read");
        console.error(failure);
        log(`❌ 无法读取本地缓存：${failure.message}`);
        recordBrowserPreflightDiagnosticFailure({
            bookId,
            bookTitle: document.title,
            pageUrl: location.href,
            sourcePageType: "detail",
            imageEnabled: getImageDownloadSetting(),
            failure: {
                scope: "storage",
                stage: "cache-read",
                code: failure.reason,
                message: failure.message
            }
        });
        showMessagePopup({
            tone: "error",
            title: "本地缓存不可用",
            message: "本次任务尚未开始。请检查浏览器存储权限或剩余空间后重试。"
        });
        return;
    }
    state.globalChaptersMap = cacheResult.map || new Map();
    // 从确认弹窗开始固定任务设置，后续其他页面修改全局设置不会影响本任务
    const imageEnabled = getImageDownloadSetting();
    const cacheHint = getImageCacheConfirmHint(cacheResult.size, cacheResult.meta?.imageEnabled, imageEnabled);

    const confirmed = await new Promise<boolean>((resolve) => {
        createConfirmPopup(
            () => resolve(true),
            () => {
                log("用户取消确认");
                resolve(false);
            },
            cacheHint
        );
    });
    if (!confirmed) {
        return;
    }

    const lockResult = await acquireBookDownloadLock(bookId, "detail");
    if (!lockResult.acquired) {
        fullCleanup(state.originalTitle);
        showBookDownloadInProgressPopup(lockResult.lock);
        return;
    }

    const lock = lockResult.lock;
    state.activeBookLock = lock;
    setAbortFlag(false);
    resetAbortController();
    const stopHeartbeat = startBookDownloadLockHeartbeat(lock, abortActiveDownload);
    createDownloadPopup();
    // 从缓存认领前开始记录，才能覆盖 claim、页面解析和正式下载阶段的失败
    startBrowserDiagnosticSession({
        taskId: lock.taskId,
        bookId,
        bookTitle: document.title,
        pageUrl: location.href,
        sourcePageType: "detail",
        imageEnabled
    });
    let downloadStarted = false;

    try {
        log("正在准备本地缓存...");
        const claimedCache = await claimBookCache(bookId, lock.taskId, imageEnabled, state.abortController?.signal);
        state.globalChaptersMap = claimedCache.map || new Map();
        if (claimedCache.invalidatedCount > 0) {
            log(
                claimedCache.compatibility === "unknown"
                    ? `⚠️ 旧缓存缺少插图设置信息，已安全失效 ${claimedCache.invalidatedCount} 章并重新抓取`
                    : `⚠️ 缓存插图设置与本次任务不同，已安全失效 ${claimedCache.invalidatedCount} 章并重新抓取`
            );
        }
        if (state.abortFlag) {
            fullCleanup(state.originalTitle);
            return;
        }

        const chaptersNodes = Array.from(document.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];

        if (chaptersNodes.length === 0) {
            recordBrowserDiagnosticFailure(
                {
                    scope: "page",
                    stage: "chapter-list",
                    code: "chapter-list-missing",
                    message: "未找到章节列表 #chapterList"
                },
                lock.taskId
            );
            showMessagePopup({
                tone: "error",
                title: "无法开始下载",
                message: "未找到章节列表 #chapterList。页面结构可能已经发生变化。"
            });
            fullCleanup(state.originalTitle);
            return;
        }

        const tasks: DownloadTask[] = chaptersNodes.map((node, index) => ({
            index,
            url: node.href,
            title: (node.getAttribute("data-title") || node.innerText || "").trim()
        }));

        const meta = parseBookMetadata(document, location.href);
        await updateBookDownloadLockTitle(lock, meta.rawBookName || meta.bookName);

        if (state.abortFlag || !(await markBookDownloadRunning(lock))) {
            if (!state.abortFlag) {
                recordBrowserDiagnosticFailure(
                    {
                        scope: "storage",
                        stage: "lock-start",
                        code: "ownership-lost",
                        message: "下载任务锁在启动前已失效"
                    },
                    lock.taskId
                );
            }
            log("下载任务已取消或任务锁已失效，未启动下载。");
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

        const options = {
            bookId,
            taskId: lock.taskId,
            bookName: meta.bookName,
            rawBookName: meta.rawBookName,
            author: meta.author,
            introTxt: meta.introTxt,
            description: meta.description,
            tags: meta.tags,
            ...(meta.coverUrl === undefined ? {} : { coverUrl: meta.coverUrl }),
            pageUrl: location.href,
            sourcePageType: "detail",
            imageEnabled,
            tasks
        } as const;
        updateBrowserDiagnosticSession(options);
        downloadStarted = true;
        await batchDownload(options);
    } catch (e: any) {
        if (state.abortFlag || e.name === "AbortError" || e.message === "User Aborted") {
            fullCleanup(state.originalTitle);
            return;
        }
        console.error(e);
        // 正式下载错误已由 coordinator 清理并显示终态弹窗；页面层只处理启动阶段错误。
        if (!downloadStarted && isBrowserDiagnosticSessionActive(lock.taskId)) {
            recordBrowserDiagnosticFailure(
                {
                    scope: e instanceof StorageError ? "storage" : "page",
                    stage: "detail-page",
                    code: e instanceof StorageError ? e.reason : e.name || "detail-page-failed",
                    message: e.message
                },
                lock.taskId
            );
            log(e instanceof StorageError ? `❌ 下载进度未保存：${e.message}` : "❌ 抓取流程异常: " + e.message);
            fullCleanup(state.originalTitle);
            showMessagePopup({
                tone: "error",
                title: "无法开始下载",
                message: e instanceof StorageError ? e.message : "下载启动过程中发生异常，请稍后重试。",
                details: e instanceof StorageError ? undefined : e.message
            });
        }
    } finally {
        finishBrowserDiagnosticSession(lock.taskId, state.abortFlag ? "cancelled" : "failed");
        const finalization = await finalizeBookDownloadTask(lock, stopHeartbeat);
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
    }
}
