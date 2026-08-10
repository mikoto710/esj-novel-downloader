import { batchDownload } from "../core/download/batch-download";
import type { DownloadTask } from "../core/download/contracts";
import { parseBookMetadata } from "../core/parser";
import { createConfirmPopup, createDownloadPopup, showBookDownloadInProgressPopup } from "../ui/popups";
import { showMessagePopup } from "../ui/dialogs/message";
import { t } from "../ui/locale";
import { abortActiveDownload, setAbortFlag, state, resetAbortController } from "../core/state";
import {
    acquireBookDownloadLock,
    getConflictingBookDownloadLock,
    markBookDownloadRunning,
    startBookDownloadLockHeartbeat,
    updateBookDownloadLockTitle
} from "../core/book-lock";
import { claimBookCache, loadBookCache } from "../core/cache/book-cache";
import { fullCleanup } from "../utils/dom";
import { finalizeBookDownloadTask } from "../core/download/task-finalizer";
import { normalizeStorageError, StorageError, toStorageFailure } from "../core/cache/storage-error";
import { getImageDownloadSetting } from "../core/config";
import { getImageCacheConfirmHint } from "../ui/messages/image-cache-compatibility";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../ui/messages/download-terminal";
import { formatStorageFailure } from "../ui/messages/storage-failure";
import {
    browserDiagnosticLog as log,
    finishBrowserDiagnosticSession,
    isBrowserDiagnosticSessionActive,
    recordBrowserDiagnosticFailure,
    recordBrowserPreflightDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSession
} from "../adapters/browser-diagnostics";
import { RangePreflightError, runRangeDownload } from "./range";

function getForumBookId(): string {
    const urlParts = location.pathname.split("/").filter(Boolean);
    for (let index = urlParts.length - 1; index >= 0; index--) {
        if (/^\d+$/.test(urlParts[index])) {
            return urlParts[index];
        }
    }
    return "";
}

/**
 * 抓取论坛页面的章节列表并启动下载
 */
export async function scrapeForum(): Promise<void> {
    state.originalTitle = document.title;

    const bid = getForumBookId();

    if (!bid) {
        log(t("page.bookIdMissing"));
        return;
    }

    const conflictingLock = await getConflictingBookDownloadLock(bid);
    if (conflictingLock) {
        showBookDownloadInProgressPopup(conflictingLock);
        return;
    }

    // 提前加载缓存，以便确认弹窗显示可恢复进度
    let cacheResult;
    try {
        cacheResult = await loadBookCache(bid);
    } catch (error) {
        const failure = normalizeStorageError(error, "read");
        const displayMessage = formatStorageFailure(toStorageFailure(failure));
        console.error(failure);
        log(t("page.cacheReadFailed", { detail: displayMessage }));
        recordBrowserPreflightDiagnosticFailure({
            bookId: bid,
            bookTitle: document.title,
            pageUrl: location.href,
            sourcePageType: "forum",
            imageEnabled: getImageDownloadSetting(),
            failure: {
                scope: "storage",
                stage: "cache-read",
                code: failure.reason,
                message: failure.message
            }
        });
        showMessagePopup({
            tone: "error",
            title: t("page.cacheUnavailable.title"),
            message: t("page.cacheUnavailable.message")
        });
        return;
    }
    state.globalChaptersMap = cacheResult.map || new Map();
    // 从确认弹窗开始固定任务设置，后续其他页面修改全局设置不会影响本任务
    const imageEnabled = getImageDownloadSetting();
    const cacheHint = getImageCacheConfirmHint(cacheResult.size, cacheResult.meta?.imageEnabled, imageEnabled);

    const confirmed = await new Promise<boolean>((resolve) => {
        createConfirmPopup(
            () => resolve(true),
            () => {
                log(t("page.userCancelled"));
                resolve(false);
            },
            cacheHint
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
    // 从缓存认领前开始记录，才能覆盖 claim、详情页获取和正式下载阶段的失败
    startBrowserDiagnosticSession(
        {
            taskId: lock.taskId,
            bookId: bid,
            bookTitle: document.title,
            pageUrl: location.href,
            sourcePageType: "forum",
            imageEnabled
        },
        { observePageClose: true }
    );
    let downloadStarted = false;

    try {
        log(t("page.cachePreparing"));
        const claimedCache = await claimBookCache(bid, lock.taskId, imageEnabled, state.abortController?.signal);
        state.globalChaptersMap = claimedCache.map || new Map();
        if (claimedCache.invalidatedCount > 0) {
            log(
                claimedCache.compatibility === "unknown"
                    ? t("page.cacheInvalidLegacyImage", { count: claimedCache.invalidatedCount })
                    : t("page.cacheInvalidImageMismatch", { count: claimedCache.invalidatedCount })
            );
        }
        if (state.abortFlag) {
            fullCleanup(state.originalTitle);
            return;
        }

        log(t("page.forumAnalyzing"));

        const detailUrl = `${location.origin}/detail/${bid}.html`;
        log(t("page.detailFetching", { url: detailUrl }));

        let doc: Document;
        try {
            const signal = state.abortController?.signal;
            const resp = await fetch(detailUrl, signal === undefined ? {} : { signal });
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
            recordBrowserDiagnosticFailure(
                {
                    scope: "page",
                    stage: "book-metadata",
                    code: e.name || "book-metadata-failed",
                    message: e.message
                },
                lock.taskId
            );
            showMessagePopup({
                tone: "error",
                title: t("page.detailFailed.title"),
                message: t("page.detailFailed.message")
            });
            fullCleanup(state.originalTitle);
            return;
        }

        if (state.abortFlag) {
            fullCleanup(state.originalTitle);
            return;
        }

        const meta = parseBookMetadata(doc, detailUrl);
        await updateBookDownloadLockTitle(lock, meta.rawBookName || meta.bookName);
        log(t("page.metadataReady", { book: meta.rawBookName }));

        let tasks: DownloadTask[] = [];
        const chapterLinks = Array.from(doc.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];

        if (chapterLinks.length > 0) {
            log(t("page.chaptersFound", { count: chapterLinks.length }));
            tasks = chapterLinks.map((node, index) => ({
                index,
                url: node.href,
                title: (node.getAttribute("data-title") || node.innerText || "").trim()
            }));
        } else {
            recordBrowserDiagnosticFailure(
                {
                    scope: "page",
                    stage: "chapter-list",
                    code: "book-detail-chapters-missing",
                    message: "book-detail-chapters-missing"
                },
                lock.taskId
            );
            showMessagePopup({
                tone: "warning",
                title: t("page.chaptersMissing.title"),
                message: t("page.chaptersMissing.message")
            });
            fullCleanup(state.originalTitle);
            return;
        }

        tasks.forEach((task) => {
            if (task.url.startsWith("/")) {
                task.url = location.origin + task.url;
            }
        });

        if (state.abortFlag || !(await markBookDownloadRunning(lock))) {
            if (!state.abortFlag) {
                recordBrowserDiagnosticFailure(
                    {
                        scope: "storage",
                        stage: "lock-start",
                        code: "ownership-lost",
                        message: "ownership-lost"
                    },
                    lock.taskId
                );
            }
            log(t("page.notStarted"));
            fullCleanup(state.originalTitle);
            if (!state.abortFlag) {
                showDownloadTerminalFailure({
                    kind: "cancellation",
                    outcome: "ownership-lost",
                    storageFailure: null
                });
            }
            return;
        }

        const options = {
            bookId: bid,
            taskId: lock.taskId,
            bookName: meta.bookName,
            rawBookName: meta.rawBookName,
            author: meta.author,
            introTxt: meta.introTxt,
            description: meta.description,
            tags: meta.tags,
            ...(meta.coverUrl === undefined ? {} : { coverUrl: meta.coverUrl }),
            pageUrl: detailUrl,
            sourcePageType: "forum",
            imageEnabled,
            tasks
        } as const;
        updateBrowserDiagnosticSession(options);
        downloadStarted = true;
        await batchDownload(options);
    } catch (e: any) {
        if (state.abortFlag || e.name === "AbortError" || e.message === "User Aborted") {
            fullCleanup(state.originalTitle);
            return;
        }
        console.error(e);
        // 正式下载错误由 coordinator 处理，页面层只处理启动错误
        if (!downloadStarted && isBrowserDiagnosticSessionActive(lock.taskId)) {
            recordBrowserDiagnosticFailure(
                {
                    scope: e instanceof StorageError ? "storage" : "page",
                    stage: "forum-page",
                    code: e instanceof StorageError ? e.reason : e.name || "forum-page-failed",
                    message: e.message
                },
                lock.taskId
            );
            const displayMessage = e instanceof StorageError ? formatStorageFailure(toStorageFailure(e)) : e.message;
            log(
                e instanceof StorageError
                    ? t("page.progressNotSaved", { detail: displayMessage })
                    : t("page.flowFailed", { detail: displayMessage })
            );
            fullCleanup(state.originalTitle);
            showMessagePopup({
                tone: "error",
                title: t("page.startFailed.title"),
                message: e instanceof StorageError ? displayMessage : t("page.startFailed.message"),
                details: e instanceof StorageError ? undefined : e.message
            });
        }
    } finally {
        finishBrowserDiagnosticSession(lock.taskId, state.abortFlag ? "cancelled" : "failed");
        const finalization = await finalizeBookDownloadTask(lock, stopHeartbeat, log);
        if (finalization.cacheClearFailure) {
            recordBrowserDiagnosticFailure(
                {
                    scope: "storage",
                    stage: "cache-discard",
                    code: finalization.cacheClearFailure.reason,
                    message: finalization.cacheClearFailure.message
                },
                lock.taskId
            );
            showCacheDiscardFailure(finalization.cacheClearFailure);
        }
    }
}

/**
 * 在论坛页锁前取得详情目录，并启动独立的连续章节范围任务
 */
export async function scrapeForumRange(): Promise<void> {
    const bookId = getForumBookId();
    if (!bookId) {
        log(t("page.bookIdMissing"));
        return;
    }
    await runRangeDownload({
        bookId,
        sourcePageType: "forum",
        pageTitle: document.title,
        async loadPlan() {
            const detailUrl = `${location.origin}/detail/${bookId}.html`;
            let response: Response;
            try {
                response = await fetch(detailUrl);
                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}`);
                }
            } catch (error) {
                throw new RangePreflightError("detail-fetch-failed", "book-metadata", { cause: error });
            }
            const doc = new DOMParser().parseFromString(await response.text(), "text/html");
            const chapterLinks = Array.from(doc.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];
            if (chapterLinks.length === 0) {
                throw new RangePreflightError("chapter-list-missing", "chapter-list");
            }
            return {
                tasks: chapterLinks.map((node, index) => ({
                    index,
                    url: new URL(node.getAttribute("href") || node.href, detailUrl).href,
                    title: (node.getAttribute("data-title") || node.innerText || "").trim()
                })),
                meta: parseBookMetadata(doc, detailUrl),
                pageUrl: detailUrl
            };
        }
    });
}
