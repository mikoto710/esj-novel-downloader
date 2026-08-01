import type {
    BookLockService,
    ChapterCacheRepository,
    ChapterFetcherPort,
    ChapterProcessorPort,
    CoverFetcherPort,
    DownloadDependencies,
    DownloadRuntimePort,
    DownloadUiPort
} from "../core/download/contracts";
import { ownsActiveBookDownloadLock, shouldDiscardBookDownloadCache } from "../core/book-lock";
import { getConcurrency, getImageDownloadSetting } from "../core/config";
import { parseChapterHtml } from "../core/parser";
import {
    abortActiveDownload,
    setCachedData,
    startRuntimeCacheSession,
    state,
    updateRuntimeCacheSession
} from "../core/state";
import { clearBookCacheForTask, saveBookCacheForTask } from "../core/storage";
import type { Chapter } from "../types";
import { createDownloadPopup, showFormatChoice } from "../ui/popups";
import { updateTrayText } from "../ui/tray";
import { fullCleanup } from "../utils/dom";
import { processHtmlImages } from "../utils/image";
import { fetchWithTimeout, log, sleep, sleepWithAbort } from "../utils/index";
import { removeImgTags } from "../utils/text";

// 下载核心的浏览器实现边界
// DOM、全局 state、网络、解析、图片、v2 缓存和锁实现均限制在本模块中
function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// 将现有页面级全局状态包装为 runtime port，避免 coordinator 直接依赖 state 单例
const runtime: DownloadRuntimePort = {
    get chapters() {
        return state.globalChaptersMap;
    },
    get signal() {
        return state.abortController?.signal;
    },
    get activeBookLock() {
        return state.activeBookLock;
    },
    get originalTitle() {
        return state.originalTitle;
    },
    isCancellationRequested: () => state.abortFlag,
    requestCancellation: abortActiveDownload,
    startCacheSession: startRuntimeCacheSession,
    updateCacheSession: updateRuntimeCacheSession,
    setExportData: setCachedData
};

// 下载核心只发布快照，所有标题、进度条、托盘和弹窗更新在此落到 DOM
const ui: DownloadUiPort = {
    prepare() {
        if (!document.querySelector("#esj-popup")) {
            createDownloadPopup();
        }
    },
    update(snapshot) {
        if (snapshot.phase !== "downloading" || snapshot.cancellationRequested || snapshot.completedCount === 0) {
            return;
        }
        const { completedCount: count, scheduledCount: total } = snapshot;
        const status = `全本下载 (${count}/${total}) `;
        const titleEl = document.querySelector("#esj-title") as HTMLElement | null;
        const progressEl = document.querySelector("#esj-progress") as HTMLElement | null;
        if (titleEl) {
            titleEl.textContent = "📌 " + status;
        }
        document.title = `[${count}/${total}] ${state.originalTitle}`;
        updateTrayText(status);
        if (progressEl) {
            progressEl.style.width = (count / total) * 100 + "%";
        }
    },
    cleanup: () => fullCleanup(state.originalTitle),
    showFormatChoice
};

// 单次章节请求，超时和重试次数由 coordinator 统一控制
const chapterFetcher: ChapterFetcherPort = {
    async fetch(task, signal) {
        const response = await fetchWithTimeout(task.url, { credentials: "include" }, 15000, signal);
        return response.text();
    }
};

// 解析正文并根据当前设置处理或移除图片
const chapterProcessor: ChapterProcessorPort = {
    async process(html, task, imageEnabled, signal) {
        const result = parseChapterHtml(html, task.title);
        let finalHtml = result.contentHtml;
        let images: Chapter["images"] = [];
        let imageErrors = 0;

        if (imageEnabled) {
            try {
                const processed = await processHtmlImages(result.contentHtml, task.index, signal);
                finalHtml = processed.processedHtml;
                images = processed.images;
                imageErrors = processed.failCount;
            } catch (error) {
                const matches = result.contentHtml.match(/<img\s/gi);
                imageErrors = matches ? matches.length : 0;
                log(
                    `⚠️ 图片处理异常，跳过 ${imageErrors} 张图片。第 ${task.index + 1} 章 标题：${task.title}，原因：${getErrorMessage(error)}`
                );
            }
        } else {
            finalHtml = removeImgTags(result.contentHtml);
        }

        return {
            title: result.title,
            content: finalHtml,
            txtSegment: `${result.title}\n\n${result.author}\n\n${result.contentText}\n\n`,
            images,
            imageErrors
        };
    }
};

// 封面是可选资源，任何获取异常都降级为无封面导出
const coverFetcher: CoverFetcherPort = {
    async fetch(url, signal) {
        try {
            log("启动封面下载...");
            const response = await fetchWithTimeout(
                url,
                { method: "GET", referrerPolicy: "no-referrer", credentials: "omit" },
                15000,
                signal
            );
            const blob = await response.blob();
            if (blob.size < 1000) {
                log("⚠ 封面文件过小，已忽略");
                return null;
            }
            const ext = blob.type.includes("png") ? "png" : "jpg";
            log("✅ 封面下载完成");
            return { blob, ext };
        } catch (error) {
            log(`⚠ 封面下载跳过: ${getErrorMessage(error)}`);
            return null;
        }
    }
};

// 增量 repository 落地前，继续适配现有 v2 全量快照接口
const cache: ChapterCacheRepository = {
    saveSnapshot: saveBookCacheForTask,
    clearForTask: clearBookCacheForTask
};

// 下载核心只查询锁状态，获取、心跳和释放仍由页面任务生命周期管理
const lock: BookLockService = {
    owns: ownsActiveBookDownloadLock,
    shouldDiscardCache: shouldDiscardBookDownloadCache
};

/**
 * 创建浏览器全本下载所需的 dependencies
 */
export function createBrowserDownloadDependencies(): DownloadDependencies {
    return {
        runtime,
        ui,
        chapterFetcher,
        chapterProcessor,
        coverFetcher,
        cache,
        lock,
        events: { emit: () => undefined },
        scheduler: {
            sleep,
            sleepWithAbort,
            randomDelay: (minInclusive, maxInclusive) =>
                Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive
        },
        settings: {
            getConcurrency,
            isImageDownloadEnabled: getImageDownloadSetting
        },
        environment: {
            currentUrl: () => location.href,
            now: () => Date.now()
        },
        log
    };
}
