import { BookDownloadLock } from "../../types";
import { releaseBookDownloadLock, shouldDiscardBookDownloadCache } from "../book-lock";
import { clearBookCacheForTask } from "../cache/book-cache";
import { clearRuntimeCacheSession, releaseActiveDownload } from "../state";
import {
    createStorageError,
    normalizeStorageError,
    toStorageFailure,
    type StorageFailure
} from "../cache/storage-error";
import type { DownloadLog } from "./contracts";

/**
 * 书籍下载收尾时的缓存清理结果
 */
export interface BookDownloadFinalizationResult {
    cacheDiscarded: boolean;
    cacheClearFailure: StorageFailure | null;
}

/**
 * 处理缓存清除请求，并在所有退出路径停止心跳、释放锁
 */
export async function finalizeBookDownloadTask(
    lock: BookDownloadLock,
    stopHeartbeat: () => void,
    logMessage?: (message: DownloadLog) => void
): Promise<BookDownloadFinalizationResult> {
    let cacheDiscarded = false;
    let cacheClearFailure: StorageFailure | null = null;
    try {
        // 远程“停止并清除”由锁携带意图，只有当前 writer 可以清除对应缓存
        if (await shouldDiscardBookDownloadCache(lock)) {
            try {
                cacheDiscarded = await clearBookCacheForTask(lock.bookId, lock.taskId);
                if (!cacheDiscarded) {
                    cacheClearFailure = toStorageFailure(createStorageError("ownership-lost", "clear"));
                    logMessage?.({
                        code: "cache-discard-failed",
                        params: {
                            reason: cacheClearFailure.reason,
                            operation: cacheClearFailure.operation,
                            detail: cacheClearFailure.params?.detail || cacheClearFailure.message
                        }
                    });
                }
            } catch (error) {
                const failure = normalizeStorageError(error, "clear");
                cacheClearFailure = toStorageFailure(failure);
                console.error("停止任务时清理缓存失败", failure);
                logMessage?.({
                    code: "cache-discard-failed",
                    params: {
                        reason: failure.reason,
                        operation: failure.operation,
                        detail: failure.params?.detail || failure.message
                    }
                });
            }
            if (cacheDiscarded) {
                clearRuntimeCacheSession(lock.bookId, lock.taskId);
            }
        }
    } finally {
        // 即使缓存清理失败也要停止心跳，否则其他页面会持续认为任务存活
        try {
            try {
                stopHeartbeat();
            } finally {
                await releaseBookDownloadLock(lock, { cacheDiscarded });
            }
        } finally {
            // 锁释放异常时仍清理当前页引用，避免后续流程误用旧锁
            releaseActiveDownload(lock.taskId);
        }
    }
    return { cacheDiscarded, cacheClearFailure };
}
