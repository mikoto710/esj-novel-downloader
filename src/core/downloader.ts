import {
    abortActiveDownload,
    state,
    setCachedData,
    startRuntimeCacheSession,
    updateRuntimeCacheSession
} from "./state";
import { log, sleepWithAbort, sleep, fetchWithTimeout } from "../utils/index";
import { fullCleanup } from "../utils/dom";
import { createDownloadPopup, showFormatChoice } from "../ui/popups";
import { updateTrayText } from "../ui/tray";
import { clearBookCacheForTask, saveBookCacheForTask } from "./storage";
import { CacheMeta, Chapter, SourcePageType } from "../types";
import { parseChapterHtml } from "./parser";
import { getConcurrency, getImageDownloadSetting } from "./config";
import { processHtmlImages } from "../utils/image";
import { removeImgTags } from "../utils/text";
import { ownsActiveBookDownloadLock, shouldDiscardBookDownloadCache } from "./book-lock";
import { getChapterRetryReason } from "./download-integrity";

export interface DownloadTask {
    index: number;
    url: string;
    title: string;
}

export interface DownloadOptions {
    bookId: string;
    taskId: string;
    bookName: string;
    rawBookName?: string;
    author?: string;
    introTxt: string;
    description: string;
    tags: string[];
    coverUrl?: string;
    pageUrl?: string;
    sourcePageType?: SourcePageType;
    tasks: DownloadTask[];
}

// 下载过程上下文，用于在各函数间传递状态和方法
interface DownloadContext {
    options: DownloadOptions;
    cacheMeta: CacheMeta;
    total: number;
    enableImage: boolean;
    ui: {
        progressEl: HTMLElement;
        titleEl: HTMLElement;
    };
    runtime: {
        completedCount: number;
    };
    updateProgress: () => void;
}

async function persistTaskCache(ctx: DownloadContext): Promise<boolean> {
    const saved = await saveBookCacheForTask(
        ctx.options.bookId,
        ctx.options.taskId,
        state.globalChaptersMap,
        ctx.cacheMeta
    );
    if (!saved) {
        log("下载任务已失去缓存写入权，正在停止旧任务。");
        abortActiveDownload();
    }
    return saved;
}

/**
 * 封面下载逻辑
 */
async function fetchCoverImage(url: string): Promise<{ blob: Blob; ext: "jpg" | "png" } | null> {
    try {
        log("启动封面下载...");
        const response = await fetchWithTimeout(
            url,
            {
                method: "GET",
                referrerPolicy: "no-referrer",
                credentials: "omit"
            },
            15000,
            state.abortController?.signal
        );

        const blob = await response.blob();

        if (blob.size < 1000) {
            log("⚠ 封面文件过小，已忽略");
            return null;
        }

        let ext: "jpg" | "png" = "jpg";
        if (blob.type.includes("png")) {
            ext = "png";
        } else if (blob.type.includes("jpeg") || blob.type.includes("jpg")) {
            ext = "jpg";
        }

        log("✔ 封面下载完成");
        return { blob, ext };
    } catch (e: any) {
        log(`⚠ 封面下载跳过: ${e.message}`);
        return null;
    }
}

/**
 * 下载 HTML 章节内容
 */
async function downloadChapterHtml(url: string, title: string): Promise<string | null> {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (state.abortFlag) {
            return null;
        }
        try {
            const res = await fetchWithTimeout(url, { credentials: "include" }, 15000, state.abortController?.signal);
            return await res.text();
        } catch (e: any) {
            if (e.name === "AbortError" || state.abortFlag) {
                return null;
            }

            if (attempt === MAX_RETRIES) {
                log(`❌ 章节获取失败 (${title}): ${e.message}`);
            } else {
                await sleepWithAbort(300 * attempt);
            }
        }
    }
    return null;
}

/**
 * 解析内容与图片处理
 */
async function handleChapterContent(html: string, task: DownloadTask, ctx: DownloadContext): Promise<void> {
    const { index, title } = task;
    const { enableImage } = ctx;

    // 解析 DOM
    const result = parseChapterHtml(html, title);
    let finalHtml = result.contentHtml;
    let chapterImages: Chapter["images"] = [];
    let imageErrors = 0;

    if (enableImage) {
        try {
            const processed = await processHtmlImages(result.contentHtml, index, state.abortController?.signal);
            finalHtml = processed.processedHtml;
            chapterImages = processed.images;
            imageErrors = processed.failCount;
        } catch (e: any) {
            const imgMatches = result.contentHtml.match(/<img\s/gi);
            imageErrors = imgMatches ? imgMatches.length : 0;
            log(`⚠️ 图片处理异常，跳过 ${imageErrors} 张图片。第 ${index + 1} 章 标题：${title}`);
        }
    } else {
        finalHtml = removeImgTags(result.contentHtml);
    }

    state.globalChaptersMap.set(index, {
        title: result.title,
        content: finalHtml,
        txtSegment: `${result.title}\n\n${result.author}\n\n${result.contentText}\n\n`,
        images: chapterImages,
        imageErrors: imageErrors
    });
}

/**
 * 处理单个章节任务
 */
async function processChapterTask(task: DownloadTask, ctx: DownloadContext, isRetry = false): Promise<void> {
    if (state.abortFlag) {
        return;
    }
    const { index, url, title } = task;
    const { total } = ctx;

    // 缓存命中
    if (!isRetry && state.globalChaptersMap.has(index)) {
        ctx.runtime.completedCount++;
        ctx.updateProgress();
        return;
    }

    // 非站内链接处理
    const isValidChapter = /\/forum\/\d+\/\d+\.html/.test(url) && url.includes("esjzone");
    if (!isValidChapter) {
        const msg = `${url} {非站內链接}`;
        state.globalChaptersMap.set(index, {
            title: title,
            content: msg,
            txtSegment: `${title}\n${msg}\n\n`
        });

        // 先更新进度，再判断是否保存
        ctx.runtime.completedCount++;
        ctx.updateProgress();

        if (!state.abortFlag && ctx.runtime.completedCount % 5 === 0) {
            await persistTaskCache(ctx);
        }

        log(`⚠️ 跳过 (${ctx.runtime.completedCount}/${total})：${title} (非站内)`);

        await sleepWithAbort(100);
        return;
    }

    // 下载 HTML
    const html = await downloadChapterHtml(url, title);
    if (!html || state.abortFlag) {
        return;
    }

    await handleChapterContent(html, task, ctx);

    if (!isRetry) {
        ctx.runtime.completedCount++;
        ctx.updateProgress();
    }

    if (!state.abortFlag) {
        if (isRetry) {
            // 补漏每补完一章就存一次
            await persistTaskCache(ctx);
        } else {
            if (ctx.runtime.completedCount % 5 === 0) {
                await persistTaskCache(ctx);
            }
        }
    }

    const chapter = state.globalChaptersMap.get(index);
    const imageErrors = chapter?.imageErrors || 0;
    const imageCount = chapter?.images?.length || 0;
    const prefix = isRetry ? "♻️ 补抓" : "✔ 抓取";

    // 如果有图片错误，优先显示错误数量
    if (imageErrors > 0) {
        log(
            `${prefix} (${ctx.runtime.completedCount}/${total}): ${title} (${imageErrors}/${imageCount + imageErrors} 张图片获取失败)\nURL: ${url}`
        );
    } else if (imageCount > 0) {
        log(`${prefix} (${ctx.runtime.completedCount}/${total}): ${title} (${imageCount} 张图片)\nURL: ${url}`);
    } else {
        log(`${prefix} (${ctx.runtime.completedCount}/${total}): ${title}\nURL: ${url}`);
    }

    if (!state.abortFlag) {
        const delay = Math.floor(Math.random() * 100) + 100;
        await sleepWithAbort(delay);
    }
}

/**
 * 完整性检查与补漏
 */
async function checkIntegrityAndRetry(tasks: DownloadTask[], ctx: DownloadContext): Promise<boolean> {
    const { total, enableImage } = ctx;

    log("正在进行章节完整性检查...");

    const missingTasks = tasks.filter((t) => {
        const chap = state.globalChaptersMap.get(t.index);
        return getChapterRetryReason(chap, enableImage) !== null;
    });

    if (missingTasks.length > 0) {
        log(`⚠ 发现 ${missingTasks.length} 个章节不完整 (缺失或含失败图片)，尝试自动补抓...`);
        for (const task of missingTasks) {
            if (state.abortFlag) {
                const lockOwned = await ownsActiveBookDownloadLock(state.activeBookLock);
                const discardCache = await shouldDiscardBookDownloadCache(state.activeBookLock);
                if (!lockOwned) {
                    log("下载任务锁已失效，跳过缓存写入。");
                } else if (discardCache) {
                    log("停止请求要求清理缓存，将在释放任务锁前统一处理。");
                } else {
                    await persistTaskCache(ctx);
                }
                fullCleanup(state.originalTitle);
                return false;
            }

            const chap = state.globalChaptersMap.get(task.index);
            const retryReason = getChapterRetryReason(chap, enableImage);
            const reason =
                retryReason === "missing"
                    ? "缺失"
                    : retryReason === "invalid-image-media-type"
                      ? "图片格式无效"
                      : `图片失败 ${chap?.imageErrors ?? 0} 张`;
            log(`补抓 [${task.index + 1}/${total}] (${reason})...`);

            await processChapterTask(task, ctx, true);

            await sleepWithAbort(300);
        }
    } else {
        log("✅ 完整性检查通过，无缺漏。");
    }

    return !state.abortFlag;
}

// 批量下载主入口
export async function batchDownload(options: DownloadOptions): Promise<void> {
    const {
        bookId,
        taskId,
        bookName,
        rawBookName,
        author,
        introTxt,
        description,
        tags,
        coverUrl,
        pageUrl,
        sourcePageType,
        tasks
    } = options;
    const total = tasks.length;

    // 初始化 UI 和状态
    let popup = document.querySelector("#esj-popup") as HTMLElement;
    if (!popup) {
        popup = createDownloadPopup();
    }
    const progressEl = document.querySelector("#esj-progress") as HTMLElement;
    const titleEl = document.querySelector("#esj-title") as HTMLElement;

    // 读取缓存
    const cachedCount = state.globalChaptersMap.size;
    if (cachedCount > 0) {
        log(`💾 已从 IndexedDB 恢复 ${cachedCount} 章缓存`);
    }

    const cacheMeta: CacheMeta = {
        bookId,
        bookName,
        rawBookName: rawBookName || bookName,
        author: author || "未知作者",
        pageUrl: pageUrl || location.href,
        totalChapters: total,
        sourcePageType: sourcePageType || "unknown",
        imageEnabled: getImageDownloadSetting(),
        updatedAt: Date.now()
    };
    startRuntimeCacheSession(cacheMeta, taskId, state.globalChaptersMap.size);

    // 启动封面下载
    const coverTaskPromise = coverUrl ? fetchCoverImage(coverUrl) : Promise.resolve(null);

    // 构造上下文
    const ctx: DownloadContext = {
        options,
        cacheMeta,
        total,
        enableImage: getImageDownloadSetting(),
        ui: { progressEl, titleEl },
        runtime: { completedCount: 0 },
        updateProgress: () => {
            if (state.abortFlag) {
                return;
            }
            const count = ctx.runtime.completedCount;
            const statusStr = `全本下载 (${count}/${total}) `;
            if (titleEl) {
                titleEl.textContent = "📘 " + statusStr;
            }
            document.title = `[${count}/${total}] ${state.originalTitle}`;
            updateTrayText(statusStr);
            if (progressEl) {
                progressEl.style.width = (count / total) * 100 + "%";
            }
            updateRuntimeCacheSession({
                completedCount: count,
                cachedChapterCount: state.globalChaptersMap.size,
                status: "downloading"
            });
        }
    };

    // 并发处理章节
    const concurrency = getConcurrency();
    const queue = [...tasks];

    async function worker() {
        while (queue.length > 0 && !state.abortFlag) {
            const task = queue.shift();
            if (task) {
                await processChapterTask(task, ctx, false);
            }
        }
    }

    log(`启动 ${concurrency} 个并发线程...`);
    const workers = Array(concurrency)
        .fill(0)
        .map(() => worker());
    await Promise.all(workers);

    // 用户取消操作
    if (state.abortFlag) {
        const lockOwned = await ownsActiveBookDownloadLock(state.activeBookLock);
        const discardCache = await shouldDiscardBookDownloadCache(state.activeBookLock);
        if (!lockOwned) {
            log("下载任务锁已失效，跳过缓存写入。");
        } else if (discardCache) {
            log("停止请求要求清理缓存，将在释放任务锁前统一处理。");
        } else {
            log("正在写入 IndexedDB...");
            await persistTaskCache(ctx);
        }
        updateRuntimeCacheSession({
            completedCount: ctx.runtime.completedCount,
            cachedChapterCount: state.globalChaptersMap.size,
            status: "cancelled",
            hasExportData: false
        });
        log(
            !lockOwned
                ? "任务锁已失效，当前任务已停止。"
                : discardCache
                  ? "任务已停止，正在清理缓存。"
                  : "任务已手动取消，进度已保存。"
        );
        await sleep(800);
        document.title = state.originalTitle;
        fullCleanup(state.originalTitle);
        return;
    }

    // 章节补漏
    const integrityPassed = await checkIntegrityAndRetry(tasks, ctx);
    if (!integrityPassed) {
        document.title = state.originalTitle;
        fullCleanup(state.originalTitle);
        return;
    }

    // 导出数据
    const coverResult = await coverTaskPromise;
    log("✅ 所有任务处理完毕");
    document.title = state.originalTitle;

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

    const cacheCleared = await clearBookCacheForTask(bookId, taskId);
    if (!cacheCleared) {
        throw new Error("下载任务已失去缓存清理权，已停止导出");
    }

    setCachedData({
        txt: finalTxt,
        chapters: chaptersArr,
        metadata: {
            title: bookName,
            author: author || "未知作者",
            description,
            tags,
            coverBlob: coverResult?.blob || null,
            coverExt: coverResult?.ext || "jpg"
        },
        epubBlob: null,
        exportContext: {
            bookId,
            rawBookName: rawBookName || bookName,
            pageUrl: pageUrl || location.href,
            sourcePageType: sourcePageType === "forum" ? "forum" : "detail",
            chapterInfo: `共 ${chaptersArr.length} 章`,
            imageEnabled: getImageDownloadSetting()
        }
    });

    updateRuntimeCacheSession({
        completedCount: total,
        cachedChapterCount: chaptersArr.length,
        status: "export-ready",
        hasExportData: true
    });

    fullCleanup(state.originalTitle);
    showFormatChoice();
}
