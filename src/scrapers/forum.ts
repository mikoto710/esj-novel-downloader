import { batchDownload } from "../core/download/batch-download";
import type { DownloadTask } from "../core/download/contracts";
import { parseBookMetadata } from "../core/parser";
import { createConfirmPopup, createDownloadPopup, showBookDownloadInProgressPopup } from "../ui/popups";
import { showMessagePopup } from "../ui/message-popup";
import { abortActiveDownload, setAbortFlag, state, resetAbortController } from "../core/state";
import {
    acquireBookDownloadLock,
    getConflictingBookDownloadLock,
    markBookDownloadRunning,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../core/book-lock";
import { claimBookCache, loadBookCache } from "../core/cache/book-cache";
import { fullCleanup } from "../utils/dom";
import { finalizeBookDownloadTask } from "../core/download/task-finalizer";
import { normalizeStorageError, StorageError, toStorageFailure } from "../core/cache/storage-error";
import { getImageDownloadSetting } from "../core/config";
import { getImageCacheConfirmHint } from "../ui/image-cache-compatibility";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../ui/download-terminal-notices";
import { formatStorageFailure } from "../adapters/browser-download-messages";
import {
    browserDiagnosticLog as log,
    finishBrowserDiagnosticSession,
    isBrowserDiagnosticSessionActive,
    recordBrowserDiagnosticFailure,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../adapters/browser-diagnostics";

/**
 * 抓取论坛页面的章节列表并启动下载
 */
export async function scrapeForum(): Promise<void> {
    state.originalTitle = document.title;

    let bid = "";

    if (!bid) {
        const urlParts = location.pathname.split("/").filter((p) => p);
        for (let i = urlParts.length - 1; i >= 0; i--) {
            if (/^\d+$/.test(urlParts[i])) {
                bid = urlParts[i];
                break;
            }
        }
    }

    if (!bid) {
        log("无法解析书籍 ID，已取消全本下载任务。");
        return;
    }

    const conflictingLock = await getConflictingBookDownloadLock(bid);
    if (conflictingLock) {
        showBookDownloadInProgressPopup(conflictingLock);
        return;
    }

    // 提前加载缓存，以便确认弹窗显示可恢复进度
    let cacheResult;
    try {
        cacheResult = await loadBookCache(bid);
    } catch (error) {
        const failure = normalizeStorageError(error, "read");
        const displayMessage = formatStorageFailure(toStorageFailure(failure));
        console.error(failure);
        log(`❌ 无法读取本地缓存：${displayMessage}`);
        recordBrowserPreflightDiagnosticFailure({
            bookId: bid,
            bookTitle: document.title,
            pageUrl: location.href,
            sourcePageType: "forum",
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

    const lockResult = await acquireBookDownloadLock(bid, "forum");
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
    // 从缓存认领前开始记录，才能覆盖 claim、详情页获取和正式下载阶段的失败
    startBrowserDiagnosticSession(
        {
            taskId: lock.taskId,
            bookId: bid,
            bookTitle: document.title,
            pageUrl: location.href,
            sourcePageType: "forum",
            imageEnabled
        },
        { observePageClose: true }
    );
    let downloadStarted = false;

    try {
        log("正在准备本地缓存...");
        const claimedCache = await claimBookCache(bid, lock.taskId, imageEnabled, state.abortController?.signal);
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

        log("正在分析论坛页面...");

        const detailUrl = `${location.origin}/detail/${bid}.html`;
        log(`正在获取书籍详情数据: ${detailUrl}`);

        let doc: Document;
        try {
            const signal = state.abortController?.signal;
            const resp = await fetch(detailUrl, signal === undefined ? {} : { signal });
            if (!resp.ok) {
                throw new Error(`HTTP Error ${resp.status}`);
            }
            const html = await resp.text();
            doc = new DOMParser().parseFromString(html, "text/html");
        } catch (e: any) {
            if (e.name === "AbortError" || e.message === "User Aborted") {
                fullCleanup(state.originalTitle);
                return;
            }
            console.error(e);
            recordBrowserDiagnosticFailure(
                {
                    scope: "page",
                    stage: "book-metadata",
                    code: e.name || "book-metadata-failed",
                    message: e.message
                },
                lock.taskId
            );
            showMessagePopup({
                tone: "error",
                title: "无法获取书籍信息",
                message: "无法获取书籍详情页数据，请稍后重试。"
            });
            fullCleanup(state.originalTitle);
            return;
        }

        if (state.abortFlag) {
            fullCleanup(state.originalTitle);
            return;
        }

        const meta = parseBookMetadata(doc, detailUrl);
        await updateBookDownloadLockTitle(lock, meta.rawBookName || meta.bookName);
        log(`元数据解析成功: 《${meta.rawBookName}》`);

        let tasks: DownloadTask[] = [];
        const chapterLinks = Array.from(doc.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];

        if (chapterLinks.length > 0) {
            log(`发现 ${chapterLinks.length} 个章节。`);
            tasks = chapterLinks.map((node, index) => ({
                index,
                url: node.href,
                title: (node.getAttribute("data-title") || node.innerText || "").trim()
            }));
        } else {
            recordBrowserDiagnosticFailure(
                {
                    scope: "page",
                    stage: "chapter-list",
                    code: "chapter-list-missing",
                    message: "书籍详情页未找到章节链接"
                },
                lock.taskId
            );
            showMessagePopup({
                tone: "warning",
                title: "未找到章节",
                message: "当前页面没有找到任何可下载的章节链接。"
            });
            fullCleanup(state.originalTitle);
            return;
        }

        tasks.forEach((task) => {
            if (task.url.startsWith("/")) {
                task.url = location.origin + task.url;
            }
        });

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
            bookId: bid,
            taskId: lock.taskId,
            bookName: meta.bookName,
            rawBookName: meta.rawBookName,
            author: meta.author,
            introTxt: meta.introTxt,
            description: meta.description,
            tags: meta.tags,
            ...(meta.coverUrl === undefined ? {} : { coverUrl: meta.coverUrl }),
            pageUrl: detailUrl,
            sourcePageType: "forum",
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
        // 正式下载错误由 coordinator 处理，页面层只处理启动错误
        if (!downloadStarted && isBrowserDiagnosticSessionActive(lock.taskId)) {
            recordBrowserDiagnosticFailure(
                {
                    scope: e instanceof StorageError ? "storage" : "page",
                    stage: "forum-page",
                    code: e instanceof StorageError ? e.reason : e.name || "forum-page-failed",
                    message: e.message
                },
                lock.taskId
            );
            const displayMessage = e instanceof StorageError ? formatStorageFailure(toStorageFailure(e)) : e.message;
            log(
                e instanceof StorageError
                    ? `❌ 下载进度未保存：${displayMessage}`
                    : "❌ 抓取流程异常: " + displayMessage
            );
            fullCleanup(state.originalTitle);
            showMessagePopup({
                tone: "error",
                title: "无法开始下载",
                message: e instanceof StorageError ? displayMessage : "下载启动过程中发生异常，请稍后重试。",
                details: e instanceof StorageError ? undefined : e.message
            });
        }
    } finally {
        finishBrowserDiagnosticSession(lock.taskId, state.abortFlag ? "cancelled" : "failed");
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
    }
}
