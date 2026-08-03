import { BookDownloadLock } from "../../types";
import { releaseBookDownloadLock, shouldDiscardBookDownloadCache } from "../book-lock";
import { clearBookCacheForTask } from "../cache/book-cache";
import { clearRuntimeCacheSession, state } from "../state";
import {
    createStorageError,
    normalizeStorageError,
    toStorageFailure,
    type StorageFailure
} from "../cache/storage-error";
import { log } from "../../utils/index";

/**
 * 收尾已取得锁的全本下载任务
 * 所有成功、失败和取消路径都必须调用本函数，确保心跳停止并最终释放任务锁
 */
export interface BookDownloadFinalizationResult {
    cacheDiscarded: boolean;
    cacheClearFailure: StorageFailure | null;
}

export async function finalizeBookDownloadTask(
    lock: BookDownloadLock,
    stopHeartbeat: () => void
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
                    log(`❌ 任务已停止，但缓存清理失败：${cacheClearFailure.message}`);
                }
            } catch (error) {
                const failure = normalizeStorageError(error, "clear");
                cacheClearFailure = toStorageFailure(failure);
                console.error("停止任务时清理缓存失败", failure);
                log(`❌ 任务已停止，但缓存清理失败：${failure.message}`);
            }
            if (cacheDiscarded) {
                clearRuntimeCacheSession(lock.bookId);
            }
        }
    } finally {
        // 即使缓存清理失败也要停止心跳，否则其他页面会持续认为任务存活
        stopHeartbeat();
        try {
            await releaseBookDownloadLock(lock, { cacheDiscarded });
        } finally {
            // 锁释放异常时仍清理当前页引用，避免后续流程误用旧锁
            if (state.activeBookLock?.taskId === lock.taskId) {
                state.activeBookLock = null;
            }
        }
    }
    return { cacheDiscarded, cacheClearFailure };
}
