import { state, setCachedData, setAbortFlag } from './state';
import { log, sleep } from '../utils/index';
import { fullCleanup } from '../utils/dom';
import { createDownloadPopup, showFormatChoice } from '../ui/popups';
import { updateTrayText } from '../ui/tray';
import { loadBookCache, saveBookCache, clearBookCache } from './storage';
import { Chapter, BookMetadata } from '../types';
import { parseChapterHtml } from './parser';

export interface DownloadTask {
    index: number;
    url: string;
    title: string;
}

export interface DownloadOptions {
    bookId: string;
    bookName: string;
    author?: string;
    introTxt: string;
    coverUrl?: string;
    tasks: DownloadTask[];
}

// 带超时控制的通用 Fetch
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 15000): Promise<Response> {
    const controller = new AbortController();
    const id = window.setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        window.clearTimeout(id);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        return response;
    } catch (e) {
        window.clearTimeout(id);
        throw e;
    }
}


export async function batchDownload(options: DownloadOptions): Promise<void> {
    const { bookId, bookName, author = "未知作者", introTxt, coverUrl, tasks } = options;
    const total = tasks.length;

    setAbortFlag(false);

    // 创建弹窗
    const popup = createDownloadPopup();
    const progressEl = document.querySelector("#esj-progress") as HTMLElement;
    const titleEl = document.querySelector("#esj-title") as HTMLElement;

    // 尝试读取缓存
    let cachedCount = 0;
    const cacheResult = await loadBookCache(bookId);
    if (cacheResult.map) {
        state.globalChaptersMap = cacheResult.map;
        cachedCount = cacheResult.size;
    }
    if (cachedCount > 0) {
        log(`💾 已从 IndexedDB 恢复 ${cachedCount} 章缓存`);
    }

    // 封面下载
    const coverTaskPromise = (async () => {
        try {
            if (!coverUrl) return null;
            log("启动封面下载...");

            const response = await fetchWithTimeout(coverUrl, {
                method: "GET",
                referrerPolicy: "no-referrer",
                credentials: "omit"
            }, 15000);

            const blob = await response.blob();

            if (blob.size < 1000) {
                log("⚠ 封面文件过小，已忽略");
                return null;
            }

            let ext: 'jpg' | 'png' = "jpg";
            if (blob.type.includes("png")) ext = "png";
            else if (blob.type.includes("jpeg") || blob.type.includes("jpg")) ext = "jpg";

            log("✔ 封面下载完成");
            return { blob, ext };
        } catch (e: any) {
            log(`⚠ 封面下载跳过: ${e.message}`);
            return null;
        }
    })();

    // 并发量
    const CONCURRENCY = 3;

    // 复制任务队列
    let queue = [...tasks];

    let completedCount = 0;

    async function processChapter(task: DownloadTask) {
        if (state.abortFlag) return;
        const { index, url, title } = task;

        // 缓存命中
        if (state.globalChaptersMap.has(index)) {
            completedCount++;
            updateProgress();
            return;
        }

        // 非站内链接处理
        if (!url.includes("esjzone.cc/forum/") || !url.endsWith(".html")) {
            const msg = `${url} {非站內链接}`;
            state.globalChaptersMap.set(index, {
                title: title,
                content: msg,
                txtSegment: `${title}\n${msg}\n\n`
            });

            if (index % 5 === 0) saveBookCache(bookId, state.globalChaptersMap);

            completedCount++;
            updateProgress();
            log(`⚠️ 跳过 (${completedCount}/${total})：${title} (非站内)`);

            await sleep(100);
            return;
        }

        // 抓取逻辑 (带重试)
        let success = false;
        const MAX_RETRIES = 3;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            if (state.abortFlag) break;

            try {
                const res = await fetchWithTimeout(url, { credentials: "include" }, 15000);
                const html = await res.text();

                // 调用解析器
                const result = parseChapterHtml(html, title);

                state.globalChaptersMap.set(index, {
                    title: result.title,
                    content: result.content,
                    txtSegment: `${result.title} [${result.author}]\n${result.content}\n\n`
                });

                if (completedCount % 5 === 0) {
                    saveBookCache(bookId, state.globalChaptersMap);
                }

                success = true;
                break;

            } catch (e) {
                if (attempt === MAX_RETRIES) {
                    log(`❌ 抓取失败 (${title}): ${e}`);
                } else {
                    await sleep(300 * attempt);
                }
            }
        }

        // 无论成功与否，都增加计数，失败的会在最后补漏环节再次尝试
        completedCount++;
        updateProgress();

        if (success) {
            log(`✔ 抓取 (${completedCount}/${total})：${title}\nURL: ${url}`);
        }

        // 随机延迟
        const delay = Math.floor(Math.random() * 200) + 100;
        await sleep(delay);
    }

    function updateProgress() {
        if (state.abortFlag) return;
        const statusStr = `全本下载（${completedCount}/${total}）`;
        if (titleEl) titleEl.textContent = "📘 " + statusStr;
        document.title = `[${completedCount}/${total}] ${state.originalTitle}`;
        updateTrayText(statusStr);
        if (progressEl) progressEl.style.width = (completedCount / total) * 100 + "%";
    }

    async function worker() {
        while (queue.length > 0 && !state.abortFlag) {
            const task = queue.shift();
            if (task) await processChapter(task);
        }
    }

    log(`启动 ${CONCURRENCY} 个并发线程...`);
    const workers = [];
    for (let k = 0; k < CONCURRENCY; k++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    if (state.abortFlag) {
        saveBookCache(bookId, state.globalChaptersMap);
        log("任务已手动取消，进度已保存。");
        document.title = state.originalTitle;
        return;
    }

    // 完整性检查与补漏
    log("正在进行章节完整性检查...");
    const missingTasks = tasks.filter(t => !state.globalChaptersMap.has(t.index));

    if (missingTasks.length > 0) {
        log(`⚠ 发现 ${missingTasks.length} 个章节抓取失败或遗漏，尝试自动补抓...`);
        for (const task of missingTasks) {
            if (state.abortFlag) {
                saveBookCache(bookId, state.globalChaptersMap);
                break;
            }
            log(`补抓 [${task.index + 1}/${total}]...`);
            await processChapter(task);
            saveBookCache(bookId, state.globalChaptersMap);
            await sleep(300);
        }
    } else {
        log("✅ 完整性检查通过，无缺漏。");
    }

    // 等待封面
    const coverResult = await coverTaskPromise;
    const finalCoverBlob = coverResult ? coverResult.blob : null;
    const finalCoverExt = coverResult ? coverResult.ext : "jpg";

    log("✅ 所有任务处理完毕");
    document.title = state.originalTitle;

    // 组装数据
    let finalTxt = introTxt;
    const chaptersArr: Chapter[] = [];
    for (let i = 0; i < total; i++) {
        const item = state.globalChaptersMap.get(i);
        if (item) {
            finalTxt += item.txtSegment;
            chaptersArr.push(item);
        } else {
            finalTxt += `第 ${i + 1} 章 获取失败\n\n`;
            chaptersArr.push({ title: `第 ${i + 1} 章 (缺失)`, content: "内容抓取失败。", txtSegment: "" });
        }
    }

    setCachedData({
        txt: finalTxt,
        chapters: chaptersArr,
        metadata: {
            title: bookName,
            author: author,
            coverBlob: finalCoverBlob,
            coverExt: finalCoverExt
        },
        epubBlob: null
    });

    clearBookCache(bookId);
    fullCleanup(state.originalTitle);
    showFormatChoice();
}