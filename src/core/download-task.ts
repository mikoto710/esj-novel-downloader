import { BookDownloadLock } from "../types";
import { releaseBookDownloadLock, shouldDiscardBookDownloadCache } from "./book-lock";
import { clearBookCacheForTask } from "./storage";
import { state } from "./state";

export async function finalizeBookDownloadTask(lock: BookDownloadLock, stopHeartbeat: () => void): Promise<void> {
    let cacheDiscarded = false;
    try {
        if (await shouldDiscardBookDownloadCache(lock)) {
            cacheDiscarded = await clearBookCacheForTask(lock.bookId, lock.taskId);
        }
    } finally {
        stopHeartbeat();
        try {
            await releaseBookDownloadLock(lock, { cacheDiscarded });
        } finally {
            if (state.activeBookLock?.taskId === lock.taskId) {
                state.activeBookLock = null;
            }
        }
    }
}
