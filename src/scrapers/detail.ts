import { abortActiveDownload, state, setAbortFlag, resetAbortController } from "../core/state";
import {
    acquireBookDownloadLock,
    getConflictingBookDownloadLock,
    markBookDownloadRunning,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../core/book-lock";
import { log } from "../utils/index";
import { fullCleanup } from "../utils/dom";
import { createConfirmPopup, createDownloadPopup, showBookDownloadInProgressPopup } from "../ui/popups";
import { batchDownload } from "../core/download/batch-download";
import type { DownloadTask } from "../core/download/contracts";
import { parseBookMetadata } from "../core/parser";
import { claimBookCache, loadBookCache } from "../core/cache/book-cache";
import { finalizeBookDownloadTask } from "../core/download/task-finalizer";
import { normalizeStorageError, StorageError } from "../core/cache/storage-error";
import { getImageDownloadSetting } from "../core/config";
import { getImageCacheConfirmHint } from "../ui/image-cache-compatibility";

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
        alert("本地缓存不可用，本次任务尚未开始。请检查浏览器存储权限或空间后重试。");
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
            alert("未找到章节列表 #chapterList");
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
            log("下载任务已取消或任务锁已失效，未启动下载。");
            fullCleanup(state.originalTitle);
            return;
        }

        await batchDownload({
            bookId,
            taskId: lock.taskId,
            bookName: meta.bookName,
            rawBookName: meta.rawBookName,
            author: meta.author,
            introTxt: meta.introTxt,
            description: meta.description,
            tags: meta.tags,
            coverUrl: meta.coverUrl,
            pageUrl: location.href,
            sourcePageType: "detail",
            imageEnabled,
            tasks
        });
    } catch (e: any) {
        if (state.abortFlag || e.name === "AbortError" || e.message === "User Aborted") {
            fullCleanup(state.originalTitle);
            return;
        }
        console.error(e);
        log(e instanceof StorageError ? `❌ 下载进度未保存：${e.message}` : "❌ 抓取流程异常: " + e.message);
        fullCleanup(state.originalTitle);
    } finally {
        await finalizeBookDownloadTask(lock, stopHeartbeat);
    }
}
