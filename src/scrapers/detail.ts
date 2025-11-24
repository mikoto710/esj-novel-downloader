import { state, setAbortFlag, resetAbortController } from '../core/state';
import { log } from '../utils/index';
import { fullCleanup } from '../utils/dom';
import { createConfirmPopup } from '../ui/popups';
import { batchDownload, DownloadTask } from '../core/downloader';
import { parseBookMetadata } from '../core/parser';
import { loadBookCache } from '../core/storage';

function getBookId(): string {
    const match = location.href.match(/\/detail\/(\d+)/);
    return match ? match[1] : 'unknown';
}

/**
 * 解析详情页的章节列表并启动下载
 */
export async function scrapeDetail(): Promise<void> {
    
    setAbortFlag(false);
    resetAbortController();

    state.originalTitle = document.title;

    // 提前加载缓存
    const bookId = getBookId();
    if (bookId !== 'unknown') {
        const cacheResult = await loadBookCache(bookId);
        if (cacheResult.map) {
            state.globalChaptersMap = cacheResult.map;
        }
    }

    return new Promise((resolveMain) => {

        createConfirmPopup(async () => {

            try {
                // 解析 DOM 获取任务列表
                const chaptersNodes = Array.from(document.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];

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
                const imgNode = document.querySelector(".product-gallery img") as HTMLImageElement;
                const coverUrl = imgNode ? imgNode.src : undefined;

                if (state.abortFlag) {
                    log("用户取消，跳过下载");
                    return;
                }

                await batchDownload({
                    bookId: getBookId(),
                    bookName: meta.bookName,
                    author: meta.author,
                    introTxt: meta.introTxt,
                    coverUrl: meta.coverUrl,
                    tasks
                });

            } catch (e: any) {
                console.error(e);
                log("❌ 抓取流程异常: " + e.message);
            } finally {
                return resolveMain();
            }

        }, () => {
            log("用户取消确认");
            return resolveMain();
        });
    });
}