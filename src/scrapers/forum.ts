import { log } from '../utils/index';
import { batchDownload, DownloadTask } from '../core/downloader';
import { parseBookMetadata } from '../core/parser';
import { createConfirmPopup, createDownloadPopup } from '../ui/popups';
import { setAbortFlag, state, resetAbortController } from '../core/state';
import { loadBookCache } from '../core/storage';
import { fullCleanup } from '../utils/dom';

/**
 * 抓取论坛页面的章节列表并启动下载
 */
export async function scrapeForum(): Promise<void> {

    setAbortFlag(false);
    resetAbortController();

    state.originalTitle = document.title;

    let bid = "";

    if (!bid) {
        const urlParts = location.pathname.split('/').filter(p => p);
        for (let i = urlParts.length - 1; i >= 0; i--) {
            if (/^\d+$/.test(urlParts[i])) {
                bid = urlParts[i];
                break;
            }
        }
    }

    // 提前加载缓存
    if (bid) {
        const cacheResult = await loadBookCache(bid);
        if (cacheResult.map) {
            state.globalChaptersMap = cacheResult.map;
        }
    }

    return new Promise<void>((resolveMain) => {
        createConfirmPopup(async () => {

            createDownloadPopup();

            try {
                log("正在分析论坛页面...");


                if (!bid) {
                    alert("无法解析版块 ID，请确保当前是有效的书籍论坛页。");
                    return;
                }

                const detailUrl = `${location.origin}/detail/${bid}.html`;
                log(`正在获取书籍详情数据: ${detailUrl}`);

                let doc: Document;
                try {
                    const resp = await fetch(detailUrl, {
                        signal: state.abortController?.signal 
                    });
                    if (!resp.ok) throw new Error(`HTTP Error ${resp.status}`);
                    const html = await resp.text();
                    doc = new DOMParser().parseFromString(html, "text/html");
                } catch (e: any) {
                    if (e.name === 'AbortError' || e.message === 'User Aborted') {
                        fullCleanup(state.originalTitle);
                        return;
                    }
                    console.error(e);
                    alert("无法获取书籍详情页数据！");
                    return;
                }

                if (state.abortFlag) {
                    fullCleanup(state.originalTitle);
                    return;
                }

                const meta = parseBookMetadata(doc!, detailUrl);
                log(`元数据解析成功: 《${meta.rawBookName}》`);

                // 尝试从 Detail 页的 #chapterList 获取
                let tasks: DownloadTask[] = [];
                const chapterLinks = Array.from(doc.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];

                if (chapterLinks.length > 0) {
                    log(`发现 ${chapterLinks.length} 个章节。`);
                    tasks = chapterLinks.map((node, index) => ({
                        index: index,
                        url: node.href,
                        title: (node.getAttribute("data-title") || node.innerText || "").trim()
                    }));
                } else {
                    alert("未找到任何章节链接！");
                    return;
                }

                // 如果从 fetch 的 doc 里解析出的 href 是相对路径 (如 /forum/...)，需要补全
                tasks.forEach(t => {
                    if (t.url.startsWith('/')) {
                        t.url = location.origin + t.url;
                    }
                });

                if (state.abortFlag) {
                    fullCleanup(state.originalTitle);
                    return;
                }

                await batchDownload({
                    bookId: bid,
                    bookName: meta.bookName,
                    introTxt: meta.introTxt,
                    coverUrl: meta.coverUrl,
                    tasks: tasks
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