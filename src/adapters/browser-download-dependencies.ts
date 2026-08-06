import type {
    BookLockService,
    ChapterCacheRepository,
    ChapterFetcherPort,
    ChapterProcessorPort,
    CoverCacheRepository,
    CoverFetcherPort,
    DownloadDependencies,
    DownloadRuntimePort,
    DownloadSnapshot,
    DownloadUiPort
} from "../core/download/contracts";
import { ownsActiveBookDownloadLock, shouldDiscardBookDownloadCache } from "../core/book-lock";
import { getConcurrency } from "../core/config";
import { parseChapterHtml } from "../core/parser";
import {
    abortActiveDownload,
    setCachedData,
    startRuntimeCacheSession,
    state,
    subscribeDownloadCancellation,
    updateRuntimeCacheSession
} from "../core/state";
import {
    clearBookCacheForTask,
    loadBookCover,
    putBookCacheBatchForTask,
    putBookCoverForTask
} from "../core/cache/book-cache";
import type { Chapter } from "../types";
import {
    closeProtectedChapterPrompt,
    confirmMappingFontDownload,
    confirmIncompleteChapters,
    createDownloadPopup,
    promptProtectedChapterPassword,
    showFormatChoice,
    showMappingFontFailure,
    updateMappingFontWarning
} from "../ui/popups";
import { updateTrayText } from "../ui/tray";
import { fullCleanup } from "../utils/dom";
import { processHtmlImages, type ImageProcessingFailure } from "../utils/image";
import { fetchWithTimeout, log, sleep, sleepWithAbort } from "../utils/index";
import { removeImgTags } from "../utils/text";
import { normalizeChapterMappingFont } from "../core/mapping-font";
import { normalizeImageBlob } from "../utils/image-format";
import { browserDiagnosticEvents, browserDiagnosticLog, recordBrowserDiagnosticFailure } from "./browser-diagnostics";
import { showDownloadTerminalFailure } from "../ui/download-terminal-notices";
import { createBrowserProtectedChapterAuth, isProtectedChapterHtml } from "./browser-protected-chapter";
import { BrowserRequestGate } from "./browser-request-gate";

// 下载核心的浏览器实现边界
// DOM、全局 state、网络、解析、图片、缓存和锁实现均限制在本模块中
function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function recordInlineImageFailures(
    task: { index: number; title: string; url: string },
    failures: ImageProcessingFailure[]
): void {
    // 插图故障只作为当前章节的附加诊断，不能影响下载核心的章节成功、补抓或导出终态。
    failures.forEach((failure) => {
        recordBrowserDiagnosticFailure({
            scope: "image",
            stage: failure.stage,
            code: failure.code,
            message: failure.message,
            imageFailureCount: failure.count,
            chapter: task
        });
    });
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
    subscribeCancellation: subscribeDownloadCancellation,
    startCacheSession: startRuntimeCacheSession,
    updateCacheSession: updateRuntimeCacheSession,
    setExportData: setCachedData
};

function updateDownloadStatus(status: string): void {
    const titleEl = document.querySelector("#esj-title") as HTMLElement | null;
    if (titleEl) {
        titleEl.textContent = "📘 " + status;
    }
    document.title = `[${status}] ${state.originalTitle}`;
    updateTrayText(status);
}

// 下载核心只发布快照，所有标题、进度条、托盘和弹窗更新在此落到 DOM
const ui: DownloadUiPort = {
    prepare() {
        if (!document.querySelector("#esj-popup")) {
            createDownloadPopup();
        }
    },
    update(snapshot) {
        if (snapshot.phase === "cancelling" || snapshot.phase === "cancelled") {
            const cancelled = snapshot.phase === "cancelled";
            const status = cancelled ? "任务已停止" : "正在停止任务...";
            const titleEl = document.querySelector("#esj-title") as HTMLElement | null;
            const cancelButton = document.querySelector("#esj-cancel") as HTMLButtonElement | null;
            if (titleEl) {
                titleEl.textContent = "📘 " + status;
            }
            if (cancelButton) {
                cancelButton.disabled = true;
                cancelButton.textContent = cancelled
                    ? "已停止"
                    : state.cancellationMode === "discard"
                      ? "正在停止..."
                      : "正在保存...";
                cancelButton.style.backgroundColor = "#999";
            }
            updateTrayText(status);
            return;
        }
        const phaseStatus: Partial<Record<DownloadSnapshot["phase"], string>> = {
            preparing: "正在初始化下载任务...",
            "restoring-cache":
                snapshot.cachedChapterCount > 0
                    ? `正在校验本地缓存 (${snapshot.cachedChapterCount} 章)`
                    : "正在准备本地缓存...",
            "flushing-cache": `正在保存下载进度 (${snapshot.readyChapterCount}/${snapshot.scheduledCount})`,
            "checking-integrity": `正在检查章节完整性 (${snapshot.readyChapterCount}/${snapshot.scheduledCount})`,
            "preparing-export": `正在准备导出 (${snapshot.readyChapterCount}/${snapshot.scheduledCount})`,
            "export-ready": `导出准备完成 (${snapshot.readyChapterCount}/${snapshot.scheduledCount})`
        };
        const status = phaseStatus[snapshot.phase];
        if (status) {
            updateDownloadStatus(status);
            return;
        }
        if (
            snapshot.phase !== "downloading" ||
            snapshot.cancellationRequested ||
            (snapshot.readyChapterCount === 0 && snapshot.protectedPendingCount === 0)
        ) {
            return;
        }
        const { readyChapterCount: count, scheduledCount: total, protectedPendingCount: pending } = snapshot;
        const downloadStatus = `正文完成 ${count}/${total}｜密码待处理 ${pending}｜正在抓取`;
        const progressEl = document.querySelector("#esj-progress") as HTMLElement | null;
        updateDownloadStatus(downloadStatus);
        document.title = `[${count}/${total}${pending > 0 ? `｜密码${pending}` : ""}] ${state.originalTitle}`;
        if (progressEl) {
            progressEl.style.width = (count / total) * 100 + "%";
        }
    },
    confirmMappingFontDownload,
    confirmIncompleteChapters,
    promptProtectedChapterPassword,
    closeProtectedChapterPrompt,
    updateMappingFontWarning,
    showMappingFontFailure,
    showTerminalFailure: showDownloadTerminalFailure,
    cleanup: () => fullCleanup(state.originalTitle),
    showFormatChoice
};

const protectedChapterDetector = { isProtected: isProtectedChapterHtml };

// 解析正文并根据当前设置处理或移除图片
const chapterProcessor: ChapterProcessorPort = {
    async process(html, task, imageEnabled, signal) {
        const result = parseChapterHtml(html, task.title);
        const normalized = await normalizeChapterMappingFont(
            {
                title: result.title,
                content: result.contentHtml,
                txtSegment: `${result.title}\n\n${result.author}\n\n${result.contentText}\n\n`
            },
            signal
        );
        let finalHtml = normalized.chapter.content;
        let images: Chapter["images"] = [];
        let imageErrors = 0;

        if (imageEnabled) {
            try {
                const processed = await processHtmlImages(finalHtml, task.index, signal);
                finalHtml = processed.processedHtml;
                images = processed.images;
                imageErrors = processed.failCount;
                if (!signal?.aborted) {
                    recordInlineImageFailures(task, processed.failures);
                }
            } catch (error) {
                const matches = finalHtml.match(/<img\s/gi);
                imageErrors = matches ? matches.length : 0;
                if (!signal?.aborted && imageErrors > 0) {
                    recordInlineImageFailures(task, [
                        {
                            stage: "processing",
                            code: "image-processing-failed",
                            message: "图片处理异常，正文已保留",
                            count: imageErrors
                        }
                    ]);
                }
                log(
                    `⚠️ 图片处理异常，跳过 ${imageErrors} 张图片。第 ${task.index + 1} 章 标题：${task.title}，原因：${getErrorMessage(error)}`
                );
            }
        } else {
            // 必须基于字体规范化后的正文去图，不能把已移除的页面 data CSS 再写回缓存
            finalHtml = removeImgTags(finalHtml);
        }

        return {
            ...normalized.chapter,
            content: finalHtml,
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
            const normalized = await normalizeImageBlob(blob);
            if (!normalized || (normalized.extension !== "jpg" && normalized.extension !== "png")) {
                log("⚠ 无法识别封面的实际 JPEG/PNG 格式，已忽略");
                return null;
            }
            log("✅ 封面下载完成");
            return {
                blob: normalized.blob,
                ext: normalized.extension,
                mediaType: normalized.extension === "png" ? "image/png" : "image/jpeg"
            };
        } catch (error) {
            log(`⚠ 封面下载跳过: ${getErrorMessage(error)}`);
            return null;
        }
    }
};

const coverCache: CoverCacheRepository = {
    load: loadBookCover,
    put: putBookCoverForTask
};

// IndexedDB 适配层只接收本批发生变化的章节
const cache: ChapterCacheRepository = {
    putBatch: putBookCacheBatchForTask,
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
    const requestGate = new BrowserRequestGate();
    // 共享租约覆盖响应正文读取，确保独占授权开始前所有普通章节请求已经完整结束。
    const chapterFetcher: ChapterFetcherPort = {
        fetch(task, signal) {
            return requestGate.runShared(async () => {
                const response = await fetchWithTimeout(task.url, { credentials: "include" }, 15000, signal);
                return response.text();
            }, signal);
        }
    };
    const protectedChapterAuth = createBrowserProtectedChapterAuth(fetchWithTimeout, requestGate);

    return {
        runtime,
        ui,
        chapterFetcher,
        chapterProcessor,
        protectedChapterDetector,
        protectedChapterAuth,
        coverFetcher,
        coverCache,
        cache,
        lock,
        events: browserDiagnosticEvents,
        scheduler: {
            sleep,
            sleepWithAbort: (ms) => sleepWithAbort(ms, state.abortController?.signal),
            randomDelay: (minInclusive, maxInclusive) =>
                Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive,
            schedule: (delayMs, callback) => {
                const timer = window.setTimeout(callback, delayMs);
                return () => window.clearTimeout(timer);
            }
        },
        settings: {
            getConcurrency
        },
        environment: {
            currentUrl: () => location.href,
            now: () => Date.now()
        },
        log: browserDiagnosticLog
    };
}
