import type { DownloadLog, DownloadLogCode } from "../core/download/contracts";
import type { LocaleKey } from "../core/locale";
import { t } from "../ui/locale";
import { formatStorageFailureText } from "../ui/storage-failure-messages";

const DIRECT_LOG_KEYS = {
    "cover-cache-hit": "download.log.coverCacheHit",
    "cover-cache-saved": "download.log.coverCacheSaved",
    "cover-cache-write-ownership-lost": "download.log.coverCacheOwnershipLost",
    "restored-mapping-font-invalid": "download.log.mappingCacheInvalid",
    "cache-restored": "download.log.cacheRestored",
    "cache-restored-with-invalidated": "download.log.cacheRestoredInvalidated",
    "chapter-fetch-failed": "download.log.chapterFetchFailed",
    "chapter-mapping-font-failed": "download.log.mappingFailed",
    "chapter-skipped-non-site": "download.log.chapterSkippedNonSite",
    "integrity-check-started": "download.log.integrityStarted",
    "integrity-check-passed": "download.log.integrityPassed",
    "integrity-check-failed": "download.log.integrityFailed",
    "missing-chapter-retry": "download.log.missingRetry",
    "missing-chapter-export-with-placeholders": "download.log.missingPlaceholder",
    "missing-chapter-retry-started": "download.log.missingRetryStarted",
    "missing-chapter-retry-saved": "download.log.missingRetrySaved",
    "cancellation-cache-write-skipped-lock-lost": "download.log.lockLost",
    "cancellation-cache-discard-requested": "download.log.discardRequested",
    "cancellation-cache-write-started": "download.log.cacheWriteStarted",
    "cache-restore-started": "download.log.cacheRestoreStarted",
    "download-started": "download.log.started",
    "download-main-flush-started": "download.log.mainFlush",
    "download-integrity-flush-started": "download.log.integrityFlush",
    "export-preparation-started": "download.log.exportPreparing",
    "download-completed": "download.log.completed"
} as const satisfies Partial<Record<DownloadLogCode, LocaleKey>>;

type DirectDownloadLogCode = keyof typeof DIRECT_LOG_KEYS;
type ComplexDownloadLogCode = Exclude<DownloadLogCode, DirectDownloadLogCode>;

function value(message: DownloadLog, key: string, fallback = ""): string {
    const entry = message.params?.[key];
    return entry === undefined ? fallback : String(entry);
}

function storageFailureText(message: DownloadLog): string {
    return formatStorageFailureText(value(message, "reason"), value(message, "detail"));
}

function chapterPosition(message: DownloadLog): string {
    return `[${value(message, "index")}/${value(message, "total")}]`;
}

function chapterTitle(message: DownloadLog): string {
    return `${chapterPosition(message)}：${value(message, "title")}`;
}

function formatChapterProcessed(message: DownloadLog): string {
    const params = {
        completed: value(message, "completed"),
        total: value(message, "total"),
        title: value(message, "title"),
        url: value(message, "url")
    };
    const base = t(
        message.params?.retry ? "download.log.chapterProcessedRetryBase" : "download.log.chapterProcessedBase",
        params
    );
    if (message.code === "chapter-processed-with-image-failures") {
        const imageErrors = Number(message.params?.imageErrors || 0);
        const imageCount = Number(message.params?.imageCount || 0);
        return t("download.log.chapterProcessedImageFailures", {
            base,
            failed: imageErrors,
            total: imageCount + imageErrors,
            url: value(message, "url")
        });
    }
    if (message.code === "chapter-processed-with-images") {
        return t("download.log.chapterProcessedImages", {
            base,
            count: value(message, "imageCount"),
            url: value(message, "url")
        });
    }
    return t(message.params?.retry ? "download.log.chapterProcessedRetry" : "download.log.chapterProcessed", params);
}

function formatIntegrityRetry(message: DownloadLog): string {
    const reason = value(message, "reason");
    const suffix =
        reason === "missing"
            ? t("download.log.integrityReasonMissing")
            : reason === "invalid-image-media-type"
              ? t("download.log.integrityReasonInvalidImage")
              : t("download.log.integrityReasonImageFailures", { count: value(message, "imageErrors") });
    return t("download.log.integrityRetry", {
        index: value(message, "index"),
        total: value(message, "total"),
        reason: suffix
    });
}

function formatCancellation(message: DownloadLog): string {
    const outcome = value(message, "outcome");
    if (outcome === "ownership-lost") {
        return t("download.log.cancelledOwnershipLost");
    }
    if (outcome === "discarded") {
        return t("download.log.cancelledDiscarded");
    }
    if (outcome === "saved") {
        return t("download.log.cancelledSaved");
    }
    if (outcome === "save-timed-out") {
        return t("download.log.cancelledSaveTimeout");
    }
    const detail = value(message, "detail");
    return t("download.log.cancelledSaveFailed", { detail: detail ? `：${detail}` : "。" });
}

function formatUnhandledDownloadLog(code: never, message: DownloadLog): string {
    return `${String(code)}${message.params ? ` ${JSON.stringify(message.params)}` : ""}`;
}

/**
 * 按当前界面语言格式化稳定下载日志消息
 */
export function formatDownloadLog(message: DownloadLog): string {
    // 下载核心只产生稳定消息码，浏览器展示层在输出时按当前界面语言格式化
    const directKey = DIRECT_LOG_KEYS[message.code as DirectDownloadLogCode];
    if (directKey) {
        return t(directKey, message.params);
    }

    const code = message.code as ComplexDownloadLogCode;
    switch (code) {
        case "cover-cache-read-failed":
            return t("download.log.coverCacheReadFailed", {
                detail: value(message, "message") || value(message, "detail")
            });
        case "cover-cache-write-failed":
            return t("download.log.coverCacheWriteFailed", {
                detail: value(message, "message") || value(message, "detail")
            });
        case "cache-write-retry":
            return t("download.log.cacheWriteRetry", { detail: storageFailureText(message) });
        case "chapter-processed":
        case "chapter-processed-with-images":
        case "chapter-processed-with-image-failures":
            return formatChapterProcessed(message);
        case "protected-chapter-retry-skipped":
            return t("protected.log.retrySkipped", { chapter: chapterTitle(message) });
        case "protected-chapter-redetected":
            return t("protected.log.redetected", { chapter: chapterTitle(message) });
        case "protected-chapter-queued":
            return t("protected.log.queued", { chapter: chapterTitle(message) });
        case "protected-chapter-skipped":
            return t("protected.log.skipped", { chapter: chapterTitle(message) });
        case "protected-chapter-connection-retry":
            return t("protected.log.connectionRetry", { chapter: chapterTitle(message) });
        case "protected-chapter-connection-failed":
            return t("protected.log.connectionFailed", { chapter: chapterTitle(message) });
        case "protected-chapter-password-rejected":
            return t("protected.log.passwordRejected", { chapter: chapterTitle(message) });
        case "protected-chapter-protocol-failed":
            return t("protected.log.protocolFailed", { chapter: chapterTitle(message) });
        case "protected-chapter-unlocked":
            return t("protected.log.unlocked", { chapter: chapterTitle(message) });
        case "chapter-integrity-retry":
            return formatIntegrityRetry(message);
        case "cancellation-finished":
            return formatCancellation(message);
        case "download-storage-failed":
            return t("download.log.storageFailed", { detail: storageFailureText(message) });
        case "cache-discard-failed":
            return t("download.log.discardFailed", { detail: storageFailureText(message) });
        default:
            return formatUnhandledDownloadLog(code, message);
    }
}
