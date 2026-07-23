import { log } from "../utils/index";
import { batchDownload, DownloadTask } from "../core/downloader";
import { parseBookMetadata } from "../core/parser";
import { createConfirmPopup, createDownloadPopup, showBookDownloadInProgressPopup } from "../ui/popups";
import { abortActiveDownload, setAbortFlag, state, resetAbortController } from "../core/state";
import {
    acquireBookDownloadLock,
    getConflictingBookDownloadLock,
    markBookDownloadRunning,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../core/book-lock";
import { claimBookCache, loadBookCache } from "../core/storage";
import { fullCleanup } from "../utils/dom";
import { finalizeBookDownloadTask } from "../core/download-task";

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

    // 提前加载缓存
    if (!bid) {
        log("无法解析书籍 ID，已取消全本下载任务。");
        return;
    }

    const conflictingLock = await getConflictingBookDownloadLock(bid);
    if (conflictingLock) {
        showBookDownloadInProgressPopup(conflictingLock);
        return;
    }

    const cacheResult = await loadBookCache(bid);
    state.globalChaptersMap = cacheResult.map || new Map();

    const confirmed = await new Promise<boolean>((resolve) => {
        createConfirmPopup(
            () => resolve(true),
            () => {
                log("用户取消确认");
                resolve(false);
            }
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

    try {
        const claimedCache = await claimBookCache(bid, lock.taskId);
        state.globalChaptersMap = claimedCache.map || new Map();

        log("正在分析论坛页面...");

        const detailUrl = `${location.origin}/detail/${bid}.html`;
        log(`正在获取书籍详情数据: ${detailUrl}`);

        let doc: Document;
        try {
            const resp = await fetch(detailUrl, {
                signal: state.abortController?.signal
            });
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
            alert("无法获取书籍详情页数据！");
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
            alert("未找到任何章节链接！");
            fullCleanup(state.originalTitle);
            return;
        }

        tasks.forEach((task) => {
            if (task.url.startsWith("/")) {
                task.url = location.origin + task.url;
            }
        });

        if (state.abortFlag || !(await markBookDownloadRunning(lock))) {
            log("下载任务已取消或任务锁已失效，未启动下载。");
            fullCleanup(state.originalTitle);
            return;
        }

        await batchDownload({
            bookId: bid,
            taskId: lock.taskId,
            bookName: meta.bookName,
            rawBookName: meta.rawBookName,
            author: meta.author,
            introTxt: meta.introTxt,
            description: meta.description,
            tags: meta.tags,
            coverUrl: meta.coverUrl,
            pageUrl: detailUrl,
            sourcePageType: "forum",
            tasks
        });
    } catch (e: any) {
        console.error(e);
        log("❌ 抓取流程异常: " + e.message);
        fullCleanup(state.originalTitle);
    } finally {
        await finalizeBookDownloadTask(lock, stopHeartbeat);
    }
}
