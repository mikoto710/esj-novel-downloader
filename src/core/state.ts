import {
    AppState,
    BookDownloadLock,
    CacheMeta,
    CachedData,
    Chapter,
    DownloadCancellationMode,
    RuntimeCacheSession
} from "../types";
import { subscribeCacheSync } from "./cache/sync";

type DownloadCancellationListener = (mode: DownloadCancellationMode) => void;

const cancellationListeners = new Set<DownloadCancellationListener>();

/**
 * 当前页面共享的下载和导出状态
 */
export const state: AppState & { abortController: AbortController | null; activeBookLock: BookDownloadLock | null } = {
    abortFlag: false,
    cancellationMode: "flush",
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
        state.runtimeCacheSession.updatedAt = Date.now();
        state.runtimeCacheSession.hasExportData = true;
    }
}

/**
 * 重置控制器，用于中止 fetch 请求
 */
export function resetAbortController() {
    state.cancellationMode = "flush";
    state.abortController = new AbortController();
}

/**
 * 中止当前下载任务及其正在进行的网络请求
 * @param mode 尚未落盘缓存的处理方式
 */
export function abortActiveDownload(mode: DownloadCancellationMode = "flush"): void {
    const firstRequest = !state.abortFlag;
    const escalatedToDiscard = state.cancellationMode !== "discard" && mode === "discard";
    if (!firstRequest && !escalatedToDiscard) {
        return;
    }
    // discard 可以覆盖已经发出的普通取消，普通取消不能降级远程清理请求
    state.cancellationMode = mode;
    setAbortFlag(true);
    state.abortController?.abort();
    for (const listener of cancellationListeners) {
        listener(state.cancellationMode);
    }
}

/**
 * 订阅当前页下载任务的取消请求
 * @param listener 取消请求监听器
 */
export function subscribeDownloadCancellation(listener: DownloadCancellationListener): () => void {
    cancellationListeners.add(listener);
    return () => cancellationListeners.delete(listener);
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
