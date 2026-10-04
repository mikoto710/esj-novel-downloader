import type { AppState, CacheMeta, CachedData, DownloadCancellationMode, RuntimeCacheSession } from "../types";
import type { DownloadCancellationPort } from "./download/contracts";
import { subscribeCacheSync } from "./cache/sync";
import { readCacheManifestV3 } from "./cache/indexeddb-repository";
import { getActiveBookDownloadLock } from "./book-lock";

/**
 * 页面只保存任务操作入口、显示摘要和最近导出
 */
export const state: AppState = {
    originalTitle: document.title || "ESJZone",
    cachedData: null,
    runtimeCacheSession: null,
    activeDownload: null
};

/**
 * 创建任务独立的取消意图和网络信号，discard 只可升级
 */
export function createDownloadCancellation(): DownloadCancellationPort & { readonly mode: DownloadCancellationMode } {
    const controller = new AbortController();
    const listeners = new Set<(mode: DownloadCancellationMode) => void>();
    let requested = false;
    let mode: DownloadCancellationMode = "flush";
    return {
        signal: controller.signal,
        get mode() {
            return mode;
        },
        isCancellationRequested: () => requested,
        requestCancellation(next = "flush") {
            if (requested && (mode === "discard" || next !== "discard")) {
                return;
            }
            // 先固定意图再中止网络；缓存 writer 使用独立信号完成有界保存
            mode = next;
            requested = true;
            controller.abort();
            listeners.forEach((listener) => listener(mode));
        },
        subscribeCancellation(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}

/**
 * 登记当前任务的停止入口，替换时先停止旧任务
 */
export function activateDownload(bookId: string, taskId: string, cancellation: DownloadCancellationPort): void {
    state.activeDownload?.requestCancellation();
    state.activeDownload = { bookId, taskId, requestCancellation: cancellation.requestCancellation };
}

/**
 * 判断回调是否仍属于页面当前任务
 */
export function isCurrentDownload(taskId: string): boolean {
    return state.activeDownload?.taskId === taskId;
}

/**
 * 移除已结束任务的操作入口，晚到收尾不影响新任务
 */
export function releaseActiveDownload(taskId: string): void {
    if (isCurrentDownload(taskId)) {
        state.activeDownload = null;
    }
}

/**
 * 将页面停止操作转发给当前任务
 */
export function abortActiveDownload(mode: DownloadCancellationMode = "flush"): void {
    state.activeDownload?.requestCancellation(mode);
}

/**
 * 仅由当前任务发布新的导出结果
 */
export function publishCachedExport(data: CachedData, taskId: string): void {
    if (isCurrentDownload(taskId)) {
        state.cachedData = data;
    }
}

/**
 * 使最近导出的 EPUB 派生产物失效，正文继续复用
 */
export function invalidateCachedEpub(): void {
    if (state.cachedData) {
        state.cachedData.epubBlob = null;
    }
}

/**
 * 启动当前页会话缓存摘要
 */
export function startRuntimeCacheSession(meta: CacheMeta, taskId: string, initialChapterCount = 0): void {
    state.runtimeCacheSession = {
        ...meta,
        taskId,
        completedCount: 0,
        bookChapterCount: initialChapterCount,
        status: "downloading",
        hasExportData: false
    };
}

/**
 * 更新当前页会话缓存摘要
 */
export function updateRuntimeCacheSession(progress: Partial<RuntimeCacheSession>, taskId: string): void {
    if (!state.runtimeCacheSession || state.runtimeCacheSession.taskId !== taskId) {
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
        if (isCurrentDownload(runtime.taskId)) {
            abortActiveDownload();
        } else {
            clearRuntimeCacheSession(event.bookId, runtime.taskId);
        }
    } catch {
        // 读取失败不能证明所有权失效，交由 writer 和心跳在后续操作中判断
    }
});
