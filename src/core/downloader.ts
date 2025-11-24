import { state, setCachedData } from './state';
import { log, sleepWithAbort, sleep } from '../utils/index';
import { fullCleanup } from '../utils/dom';
import { createDownloadPopup, showFormatChoice } from '../ui/popups';
import { updateTrayText } from '../ui/tray';
import { loadBookCache, saveBookCache, clearBookCache } from './storage';
import { Chapter } from '../types';
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

    // 获取全局中断信号
    const globalSignal = state.abortController?.signal;

    // 监听全局中断
    let onGlobalAbort: (() => void) | undefined;

    // 无论 fetch 在干什么，这个 Promise 会瞬间报错，强行结束 await
    const abortPromise = new Promise<never>((_, reject) => {
        if (globalSignal?.aborted) {
            return reject(new Error('User Aborted'));
        }
        onGlobalAbort = () => reject(new Error('User Aborted'));
        globalSignal?.addEventListener('abort', onGlobalAbort);
    });

    const fetchPromise = fetch(url, {
        ...options,
        signal: controller.signal
    }).then(res => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return res;
    });

    try {
        // 用户一点取消，abortPromise 就会立刻 reject，跳过 fetch 的等待
        const response = await Promise.race([fetchPromise, abortPromise]);
        clearTimeout(id);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        return response;
    } catch (e) {
        clearTimeout(id);
        controller.abort();
        throw e;
    } finally {
        if (globalSignal && onGlobalAbort) {
            globalSignal.removeEventListener('abort', onGlobalAbort);
        }
    }
}


export async function batchDownload(options: DownloadOptions): Promise<void> {
    const { bookId, bookName, author = "未知作者", introTxt, coverUrl, tasks } = options;
    const total = tasks.length;

    // 创建弹窗
    let popup = document.querySelector("#esj-popup") as HTMLElement;
    if (!popup) {
        popup = createDownloadPopup();
    }

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
        const isValidChapter = /\/forum\/\d+\/\d+\.html/.test(url)
            && url.includes("esjzone");
        if (!isValidChapter) {
            const msg = `${url} {非站內链接}`;
            state.globalChaptersMap.set(index, {
                title: title,
                content: msg,
                txtSegment: `${title}\n${msg}\n\n`
            });

            if (!state.abortFlag && completedCount % 5 === 0) {
                saveBookCache(bookId, state.globalChaptersMap);
            }

            completedCount++;
            updateProgress();
            log(`⚠️ 跳过 (${completedCount}/${total})：${title} (非站内)`);

            await sleepWithAbort(100);
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
                    txtSegment: `${result.title}\n\n${result.author}\n\n${result.content}\n\n`
                });

                if (!state.abortFlag && completedCount % 5 === 0) {
                    saveBookCache(bookId, state.globalChaptersMap);
                }

                success = true;
                break;

            } catch (e: any) {
                if (e.name === 'AbortError' || state.abortFlag) {
                    return;
                }
                if (attempt === MAX_RETRIES) {
                    log(`❌ 抓取失败 (${title}): ${e}`);
                } else {
                    await sleepWithAbort(300 * attempt);
                }
            }
        }

        if (state.abortFlag) return;

        // 无论成功与否，都增加计数，失败的会在最后补漏环节再次尝试
        completedCount++;
        updateProgress();

        if (success) {
            log(`✔ 抓取 (${completedCount}/${total})：${title}\nURL: ${url}`);
        }

        // 随机延迟
        const delay = Math.floor(Math.random() * 200) + 100;
        await sleepWithAbort(delay);
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

        log("正在写入 IndexedDB...");
        await saveBookCache(bookId, state.globalChaptersMap);
        log("任务已手动取消，进度已保存。");

        await sleep(800);

        document.title = state.originalTitle;
        fullCleanup(state.originalTitle);
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
            await sleepWithAbort(300);
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