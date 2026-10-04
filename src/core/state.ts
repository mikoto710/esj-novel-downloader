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
import { readCacheManifestV3 } from "./cache/indexeddb-repository";
import { getActiveBookDownloadLock } from "./book-lock";

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
export function updateRuntimeCacheSession(progress: Partial<RuntimeCacheSession>, taskId?: string): void {
    if (!state.runtimeCacheSession || (taskId && state.runtimeCacheSession.taskId !== taskId)) {
        return;
    }

    state.runtimeCacheSession = {
        ...state.runtimeCacheSession,
        ...progress,
        updatedAt: progress.updatedAt ?? Date.now()
    };
}

/**
 * 移除指定任务摘要，保留章节表和最近导出
 */
export function clearRuntimeCacheSession(bookId?: string, taskId?: string): void {
    if (
        (bookId && state.runtimeCacheSession?.bookId !== bookId) ||
        (taskId && state.runtimeCacheSession?.taskId !== taskId)
    ) {
        return;
    }

    state.runtimeCacheSession = null;
}

/**
 * 显式清除对应书籍的导出结果
 */
export function clearCachedExport(bookId?: string): void {
    if (bookId && state.cachedData?.exportContext?.bookId !== bookId) {
        return;
    }
    state.cachedData = null;
}

/**
 * 重置所有全局状态
 */
export function resetGlobalState(): void {
    clearRuntimeCacheSession();
    clearCachedExport();
    console.log("内存状态已重置");
}

subscribeCacheSync(async (event) => {
    const runtime = state.runtimeCacheSession;
    if (!runtime || runtime.bookId !== event.bookId || event.type === "cache-saved") {
        return;
    }

    try {
        // 旧页面的清除通知没有任务身份，先复核，避免晚到通知中断新 writer
        const [manifest, lock] = await Promise.all([
            readCacheManifestV3(event.bookId),
            getActiveBookDownloadLock(event.bookId)
        ]);
        if (state.runtimeCacheSession?.taskId !== runtime.taskId) {
            return;
        }
        const sameWriter = manifest && !manifest.cleared && manifest.writerTaskId === runtime.taskId;
        const sameLock = lock?.taskId === runtime.taskId;
        if ((sameWriter && (!lock || sameLock)) || (!manifest && sameLock)) {
            return;
        }
        if (state.activeBookLock?.taskId === runtime.taskId) {
            abortActiveDownload();
        } else {
            clearRuntimeCacheSession(event.bookId, runtime.taskId);
        }
    } catch {
        // 读取失败不能证明所有权失效，交由 writer 和心跳在后续操作中判断
    }
});
