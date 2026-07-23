import { AppState, BookDownloadLock, CacheMeta, CachedData, Chapter, RuntimeCacheSession } from "../types";
import { subscribeCacheSync } from "./cache-sync";

export const state: AppState & { abortController: AbortController | null; activeBookLock: BookDownloadLock | null } = {
    abortFlag: false,
    originalTitle: document.title || "ESJZone",
    cachedData: null,
    globalChaptersMap: new Map<number, Chapter>(),
    runtimeCacheSession: null,
    abortController: null,
    activeBookLock: null
};

/**
 * 设置中止状态
 */
export function setAbortFlag(val: boolean): void {
    state.abortFlag = val;
}

/**
 * 缓存数据到全局状态
 */
export function setCachedData(data: CachedData): void {
    state.cachedData = data;

    if (state.runtimeCacheSession) {
        state.runtimeCacheSession.cachedChapterCount = data.chapters.length;
        state.runtimeCacheSession.updatedAt = Date.now();
        state.runtimeCacheSession.hasExportData = true;
    }
}

/**
 * 重置控制器，用于中止 fetch 请求
 */
export function resetAbortController() {
    state.abortController = new AbortController();
}

/**
 * 中止当前下载任务及其正在进行的网络请求。
 */
export function abortActiveDownload(): void {
    setAbortFlag(true);
    state.abortController?.abort();
}

/**
 * 启动当前页会话缓存摘要
 */
export function startRuntimeCacheSession(meta: CacheMeta, taskId: string, initialChapterCount = 0): void {
    state.runtimeCacheSession = {
        ...meta,
        taskId,
        completedCount: 0,
        cachedChapterCount: initialChapterCount,
        status: "downloading",
        hasExportData: false
    };
}

/**
 * 更新当前页会话缓存摘要
 */
export function updateRuntimeCacheSession(progress: Partial<RuntimeCacheSession>): void {
    if (!state.runtimeCacheSession) {
        return;
    }

    state.runtimeCacheSession = {
        ...state.runtimeCacheSession,
        ...progress,
        updatedAt: progress.updatedAt ?? Date.now()
    };
}

/**
 * 清理当前页会话缓存
 */
export function clearRuntimeCacheSession(bookId?: string): void {
    if (bookId && state.runtimeCacheSession?.bookId !== bookId) {
        return;
    }

    state.runtimeCacheSession = null;
    state.cachedData = null;
    state.globalChaptersMap.clear();
}

/**
 * 重置所有全局状态
 */
export function resetGlobalState(): void {
    clearRuntimeCacheSession();
    // state.abortFlag = false;
    console.log("内存状态已重置");
}

subscribeCacheSync((event) => {
    const runtime = state.runtimeCacheSession;
    if (!runtime || runtime.bookId !== event.bookId || runtime.hasExportData) {
        return;
    }

    if (event.type === "cache-cleared" || (event.type === "cache-claimed" && event.taskId !== runtime.taskId)) {
        clearRuntimeCacheSession(event.bookId);
    }
});
