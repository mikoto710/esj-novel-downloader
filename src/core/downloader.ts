import { state, setCachedData } from './state';
import { log, sleepWithAbort, sleep, fetchWithTimeout } from '../utils/index';
import { fullCleanup } from '../utils/dom';
import { createDownloadPopup, showFormatChoice } from '../ui/popups';
import { updateTrayText } from '../ui/tray';
import { loadBookCache, saveBookCache, clearBookCache } from './storage';
import { Chapter } from '../types';
import { parseChapterHtml } from './parser';
import { getConcurrency, getImageDownloadSetting } from './config';
import { processHtmlImages } from '../utils/image';

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

/**
 * 批量下载章节
 */
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

    // 获取自定义配置
    const concurrency = getConcurrency();
    const enableImage = getImageDownloadSetting();

    // 复制任务队列
    let queue = [...tasks];

    let completedCount = 0;

    async function processChapter(task: DownloadTask, isRetry = false) {
        if (state.abortFlag) return;
        const { index, url, title } = task;

        // 缓存命中
        if (!isRetry && state.globalChaptersMap.has(index)) {
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

        // 抓取 HTML
        let chapterHtml = "";
        let success = false;
        const MAX_RETRIES = 3;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            if (state.abortFlag)
                break;

            try {
                const res = await fetchWithTimeout(url, { credentials: "include" }, 15000);
                chapterHtml = await res.text();
                success = true;
                break;
            } catch (e: any) {
                if (e.name === 'AbortError' || state.abortFlag) return;

                if (attempt === MAX_RETRIES) {
                    log(`❌ 章节获取失败 (${title}): ${e.message}`);
                } else {
                    await sleepWithAbort(300 * attempt);
                }
            }
        }

        // 如果 HTML 没拿到，或者是被取消了，直接结束这一章的处理
        if (!success || state.abortFlag)
            return;

        // 解析 DOM
        const result = parseChapterHtml(chapterHtml, title);
        let finalHtml = result.contentHtml;
        let chapterImages: any[] = [];
        let imageErrors = 0;

        if (enableImage) {
            try {
                const processed = await processHtmlImages(
                    result.contentHtml,
                    index,
                    state.abortController?.signal
                );
                finalHtml = processed.processedHtml;
                chapterImages = processed.images;
                imageErrors = processed.failCount;
            } catch (imgErr: any) {
                // console.error(`第 ${index + 1} 章图片处理崩溃，回退到纯文本模式`, imgErr);
                const imgMatches = result.contentHtml.match(/<img\s/gi);
                imageErrors = imgMatches ? imgMatches.length : 0;
                log(`⚠️ 图片处理异常，跳过 ${imageErrors} 张图片。第 ${index + 1} 章 标题：${title}`);
            }
        }

        state.globalChaptersMap.set(index, {
            title: result.title,
            content: finalHtml,
            txtSegment: `${result.title}\n\n${result.author}\n\n${result.contentText}\n\n`,
            images: chapterImages,
            imageErrors: imageErrors
        });


        if (!state.abortFlag && completedCount % 5 === 0) {
            saveBookCache(bookId, state.globalChaptersMap);
        }

        if (!isRetry) {
            completedCount++;
            updateProgress();
        }

        // 根据图片情况显示不同日志
        if (success) {
            const prefix = isRetry ? "♻️ 补抓成功" : "✔ 抓取";
            const imageCount = chapterImages.length;
            if (imageErrors > 0) {
                log(`${prefix} (${completedCount}/${total})：${title} (${imageErrors}/${imageCount + imageErrors} 张图片获取失败)\nURL: ${url}`);
            } else if (imageCount > 0 && imageErrors === 0) {
                log(`${prefix} (${completedCount}/${total})：${title} (${imageCount} 张图片)\nURL: ${url}`);
            } else {
                log(`${prefix} (${completedCount}/${total})：${title}\nURL: ${url}`);
            }
        }

        if (!state.abortFlag) {
            const delay = Math.floor(Math.random() * 100) + 100;
            await sleepWithAbort(delay);
        }
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
            if (task) await processChapter(task, false);
        }
    }

    log(`启动 ${concurrency} 个并发线程...`);
    const workers = [];
    for (let k = 0; k < concurrency; k++) {
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
    const missingTasks = tasks.filter(t => {
        const chap = state.globalChaptersMap.get(t.index);
        if (!chap) 
            return true;
        if (enableImage && chap.imageErrors && chap.imageErrors > 0)
            return true;
        return false;
    });

    if (missingTasks.length > 0) {
        log(`⚠ 发现 ${missingTasks.length} 个章节不完整 (缺失或含失败图片)，尝试自动补抓...`);
        for (const task of missingTasks) {
            if (state.abortFlag) {
                await saveBookCache(bookId, state.globalChaptersMap);
                fullCleanup(state.originalTitle);
                break;
            }
            
            const chap = state.globalChaptersMap.get(task.index);
            const reason = !chap ? "缺失" : `图片失败 ${chap.imageErrors} 张`;
            log(`补抓 [${task.index + 1}/${total}] (${reason})...`);

            await processChapter(task, true);
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