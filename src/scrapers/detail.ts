import { state, setAbortFlag, resetAbortController } from "../core/state";
import {
    acquireBookDownloadLock,
    markBookDownloadRunning,
    releaseBookDownloadLock,
    startBookDownloadLockHeartbeat
} from "../core/book-lock";
import { log } from "../utils/index";
import { fullCleanup } from "../utils/dom";
import { createConfirmPopup, showBookDownloadInProgressPopup } from "../ui/popups";
import { batchDownload, DownloadTask } from "../core/downloader";
import { parseBookMetadata } from "../core/parser";
import { loadBookCache } from "../core/storage";

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

    const lockResult = await acquireBookDownloadLock(bookId, "detail");
    if (!lockResult.acquired) {
        showBookDownloadInProgressPopup(lockResult.lock);
        return;
    }

    const lock = lockResult.lock;
    state.activeBookLock = lock;
    const stopHeartbeat = startBookDownloadLockHeartbeat(lock);

    setAbortFlag(false);
    resetAbortController();

    state.originalTitle = document.title;

    // 提前加载缓存
    const cacheResult = await loadBookCache(bookId);
    if (cacheResult.map) {
        state.globalChaptersMap = cacheResult.map;
    }

    return new Promise<void>((resolveMain) => {
        createConfirmPopup(
            async () => {
                try {
                    const lockOwned = await markBookDownloadRunning(lock);
                    if (!lockOwned) {
                        log("下载任务锁已失效，未启动重复下载。");
                        return;
                    }
                    // 解析 DOM 获取任务列表
                    const chaptersNodes = Array.from(
                        document.querySelectorAll("#chapterList a")
                    ) as HTMLAnchorElement[];

                    if (chaptersNodes.length === 0) {
                        alert("未找到章节列表 #chapterList");
                        fullCleanup(state.originalTitle);
                        return resolveMain();
                    }

                    // 构造任务队列
                    const tasks: DownloadTask[] = chaptersNodes.map((node, index) => ({
                        index: index,
                        url: node.href,
                        title: (node.getAttribute("data-title") || node.innerText || "").trim()
                    }));

                    // 解析元数据
                    const meta = parseBookMetadata(document, location.href);

                    if (state.abortFlag) {
                        log("用户取消，跳过下载");
                        return;
                    }

                    await batchDownload({
                        bookId,
                        bookName: meta.bookName,
                        rawBookName: meta.rawBookName,
                        author: meta.author,
                        introTxt: meta.introTxt,
                        description: meta.description,
                        tags: meta.tags,
                        coverUrl: meta.coverUrl,
                        pageUrl: location.href,
                        sourcePageType: "detail",
                        tasks
                    });
                } catch (e: any) {
                    console.error(e);
                    log("❌ 抓取流程异常: " + e.message);
                } finally {
                    resolveMain();
                }
            },
            () => {
                log("用户取消确认");
                resolveMain();
            }
        );
    }).finally(async () => {
        stopHeartbeat();
        await releaseBookDownloadLock(lock);
        if (state.activeBookLock?.taskId === lock.taskId) {
            state.activeBookLock = null;
        }
    });
}
