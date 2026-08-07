import type { StorageFailure } from "../core/cache/storage-error";
import type { DownloadLog } from "../core/download/contracts";
import { t } from "../ui/locale";

function value(message: DownloadLog, key: string, fallback = ""): string {
    const entry = message.params?.[key];
    return entry === undefined ? fallback : String(entry);
}

const STORAGE_FAILURE_KEYS = {
    "quota-exceeded": "download.storage.quotaExceeded",
    "ownership-lost": "download.storage.ownershipLost",
    "transaction-aborted": "download.storage.transactionAborted",
    "database-unavailable": "download.storage.databaseUnavailable",
    "migration-failed": "download.storage.migrationFailed",
    "flush-timeout": "download.storage.flushTimeout",
    "unknown-storage-error": "download.storage.unknown"
} as const;

function storageFailureSummary(reason: string): string {
    const key = STORAGE_FAILURE_KEYS[reason as keyof typeof STORAGE_FAILURE_KEYS];
    return key ? t(key) : reason;
};

function formatStorageFailureText(reason: string, detail = ""): string {
    const summary = storageFailureSummary(reason);
    return detail && detail !== summary ? `${summary}：${detail}` : summary;
}

export function formatStorageFailure(failure: StorageFailure): string {
    const detail = typeof failure.params?.detail === "string" ? failure.params.detail : "";
    return formatStorageFailureText(failure.reason, detail);
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
    const base = t(message.params?.retry ? "download.log.chapterProcessedRetry" : "download.log.chapterProcessed", params)
        .split("\nURL:")[0];
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
            ? "缺失"
            : reason === "invalid-image-media-type"
              ? "图片格式无效"
              : `图片失败 ${value(message, "imageErrors")} 张`;
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

/**
 * 暂时将无语言核心日志映射为现有界面文案，后续由 locale 字典替换
 */
export function formatDownloadLog(message: DownloadLog): string {
    switch (message.code) {
        case "cover-cache-hit":
            return t("download.log.coverCacheHit");
        case "cover-cache-read-failed":
            return t("download.log.coverCacheReadFailed", { detail: value(message, "message") || value(message, "detail") });
        case "cover-cache-saved":
            return t("download.log.coverCacheSaved");
        case "cover-cache-write-ownership-lost":
            return t("download.log.coverCacheOwnershipLost");
        case "cover-cache-write-failed":
            return t("download.log.coverCacheWriteFailed", { detail: value(message, "message") || value(message, "detail") });
        case "restored-mapping-font-invalid":
            return `⚠️ 旧缓存映射字体无效，将重新抓取 (${value(message, "title")}): ${value(message, "detail")}`;
        case "cache-restored":
            return t("download.log.cacheRestored", { count: value(message, "count") });
        case "cache-restored-with-invalidated":
            return t("download.log.cacheRestoredInvalidated", { count: value(message, "count"), invalidatedCount: value(message, "invalidatedCount") });
        case "cache-write-retry":
            return t("download.log.cacheWriteRetry", { detail: storageFailureText(message) });
        case "chapter-fetch-failed":
            return t("download.log.chapterFetchFailed", { title: value(message, "title"), detail: value(message, "detail") });
        case "chapter-mapping-font-failed":
            return `❌ 映射字体解析失败: ${value(message, "detail")} (${value(message, "title")})`;
        case "chapter-processed":
        case "chapter-processed-with-images":
        case "chapter-processed-with-image-failures":
            return formatChapterProcessed(message);
        case "chapter-skipped-non-site":
            return t("download.log.chapterSkippedNonSite", { completed: value(message, "completed"), total: value(message, "total"), title: value(message, "title") });
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
        case "integrity-check-started":
            return t("download.log.integrityStarted");
        case "integrity-check-passed":
            return t("download.log.integrityPassed");
        case "integrity-check-failed":
            return t("download.log.integrityFailed", { count: value(message, "count") });
        case "chapter-integrity-retry":
            return formatIntegrityRetry(message);
        case "missing-chapter-retry":
            return t("download.log.missingRetry", { index: value(message, "index"), total: value(message, "total") });
        case "missing-chapter-export-with-placeholders":
            return t("download.log.missingPlaceholder", { count: value(message, "count") });
        case "missing-chapter-retry-started":
            return t("download.log.missingRetryStarted", { count: value(message, "count") });
        case "missing-chapter-retry-saved":
            return t("download.log.missingRetrySaved");
        case "cancellation-cache-write-skipped-lock-lost":
            return t("download.log.lockLost");
        case "cancellation-cache-discard-requested":
            return t("download.log.discardRequested");
        case "cancellation-cache-write-started":
            return t("download.log.cacheWriteStarted");
        case "cancellation-finished":
            return formatCancellation(message);
        case "cache-restore-started":
            return t("download.log.cacheRestoreStarted", { count: value(message, "count") });
        case "download-started":
            return t("download.log.started", { concurrency: value(message, "concurrency") });
        case "download-main-flush-started":
            return t("download.log.mainFlush");
        case "download-integrity-flush-started":
            return t("download.log.integrityFlush");
        case "export-preparation-started":
            return t("download.log.exportPreparing");
        case "download-completed":
            return t("download.log.completed");
        case "download-storage-failed":
            return t("download.log.storageFailed", { detail: storageFailureText(message) });
        case "cache-discard-failed":
            return t("download.log.discardFailed", { detail: storageFailureText(message) });
        default:
            return `${message.code}${message.params ? ` ${JSON.stringify(message.params)}` : ""}`;
    }
}
