import type { DownloadCancellationMode } from "../download/contracts";
import type { CachedData } from "./export";
import type { CacheMeta } from "../storage/cache/model";
import type { DownloadCancellationPort } from "../download/contracts";
import { subscribeCacheSync } from "../storage/cache/sync";
import { readCacheManifestV3 } from "../storage/cache/indexeddb-repository";
import { getActiveBookDownloadLock } from "../storage/book-lock";

/**
 * 缓存条目的业务状态
 */
export type CacheStatus = "downloading" | "cancelled" | "export-ready" | "persisted";

/**
 * 当前页书籍任务的缓存摘要，不持有章节内容
 */
export interface RuntimeCacheSession extends CacheMeta {
    taskId: string;
    completedCount: number;
    bookChapterCount: number;
    status: CacheStatus;
    hasExportData: boolean;
}

/**
 * 页面会话只持有停止入口、显示摘要与最近结果
 */
export interface AppState {
    originalTitle: string;
    cachedData: CachedData | null;
    runtimeCacheSession: RuntimeCacheSession | null;
    activeDownload: {
        bookId: string;
        taskId: string;
        requestCancellation(mode?: DownloadCancellationMode): void;
    } | null;
}

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
 * 登记当前任务的停止入口，替换前请求取消旧任务，不等待其收尾
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
 * 按 taskId 移除当前操作入口，晚到收尾不影响新任务
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
        data.epubBlob ??= null;
        state.cachedData = data;
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
 * 按已提供的书籍和任务身份清除摘要，省略筛选时清除当前摘要，保留章节表和导出
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
 * 清除匹配书籍的保留导出结果，未指定书籍时直接清除当前结果
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
