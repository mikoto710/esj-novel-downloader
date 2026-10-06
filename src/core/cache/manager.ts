import { CacheListItem, CacheStatus } from "../../types";
import type { PersistentCacheEntry } from "../../storage/cache/model";
import { clearCachedExport, clearRuntimeCacheSession, state } from "../state";
import { clearAllPersistentCaches, clearBookCache, listBookCaches } from "../../storage/cache/book-cache";
import {
    getActiveBookDownloadLock,
    listActiveBookDownloadLocks,
    requestBookDownloadCancellation,
    waitForBookDownloadCancellation
} from "../../storage/book-lock";

/**
 * 缓存管理器支持的清理范围
 */
export type CacheClearScope = "indexeddb" | "runtime" | "all";

/**
 * 缓存清理结果
 */
export interface CacheClearResult {
    protectedBookIds: string[];
}

/**
 * 停止活动任务并清理缓存的结果
 */
export interface StopAndClearResult {
    requested: boolean;
    cleared: boolean;
    status: "not-active" | "cleared" | "cleanup-failed" | "replaced" | "stale" | "timeout";
}

function createPersistentListItem(entry: PersistentCacheEntry): CacheListItem {
    return {
        bookId: entry.bookId,
        bookName: entry.meta?.rawBookName || entry.meta?.bookName || `Book ${entry.bookId}`,
        ...(entry.meta?.rawBookName ? { rawBookName: entry.meta.rawBookName } : {}),
        author: entry.meta?.author || "-",
        pageUrl: entry.meta?.pageUrl || "",
        totalChapters: entry.totalChapters,
        progressCount: entry.chapterCount,
        persistentChapterCount: entry.chapterCount,
        runtimeChapterCount: 0,
        runtimeCompletedCount: 0,
        updatedAt: entry.updatedAt,
        sourcePageType: entry.meta?.sourcePageType || "unknown",
        imageEnabled: entry.meta?.imageEnabled ?? null,
        sources: ["indexeddb"],
        status: "persisted",
        hasExportData: false,
        isLegacy: entry.isLegacy,
        activeTask: false
    };
}

function mergeStatus(current: CacheStatus, next: CacheStatus): CacheStatus {
    // 多来源条目合并时优先展示更接近运行中的状态
    const priority: Record<CacheStatus, number> = {
        downloading: 4,
        "export-ready": 3,
        cancelled: 2,
        persisted: 1
    };

    return priority[next] > priority[current] ? next : current;
}

/**
 * 合并持久缓存、当前页会话和活动任务锁
 */
export async function listManagedCaches(): Promise<CacheListItem[]> {
    const [persistentEntries, activeLocks] = await Promise.all([listBookCaches(), listActiveBookDownloadLocks()]);
    const result = new Map<string, CacheListItem>();
    const persistentByBookId = new Map(persistentEntries.map((entry) => [entry.bookId, entry]));
    const activeLockByBookId = new Map(activeLocks.map((lock) => [lock.bookId, lock]));

    // 持久缓存作为列表基础数据
    persistentEntries.forEach((entry) => {
        result.set(entry.bookId, createPersistentListItem(entry));
    });

    // 当前页会话必须仍对应同一 writer 和活动锁才能参与合并
    const runtime = state.runtimeCacheSession;
    if (runtime) {
        const existing = result.get(runtime.bookId);
        const persistentTaskId = persistentByBookId.get(runtime.bookId)?.writerTaskId;
        const activeTaskId = activeLockByBookId.get(runtime.bookId)?.taskId;
        const isCurrentRuntime =
            (!persistentTaskId || persistentTaskId === runtime.taskId) &&
            (!activeTaskId || activeTaskId === runtime.taskId);

        if (isCurrentRuntime) {
            const mergedSources = existing ? [...existing.sources] : [];
            if (!mergedSources.includes("runtime")) {
                mergedSources.push("runtime");
            }

            const persistentChapterCount = existing?.persistentChapterCount || 0;
            const progressCount = Math.max(runtime.completedCount, runtime.bookChapterCount, persistentChapterCount);

            const rawBookName = runtime.rawBookName || existing?.rawBookName;
            result.set(runtime.bookId, {
                bookId: runtime.bookId,
                bookName: runtime.rawBookName || runtime.bookName || existing?.bookName || `Book ${runtime.bookId}`,
                ...(rawBookName ? { rawBookName } : {}),
                author: runtime.author || existing?.author || "-",
                pageUrl: runtime.pageUrl || existing?.pageUrl || "",
                totalChapters: runtime.totalChapters || existing?.totalChapters || null,
                progressCount,
                persistentChapterCount,
                runtimeChapterCount: runtime.bookChapterCount,
                runtimeCompletedCount: runtime.completedCount,
                updatedAt: Math.max(existing?.updatedAt || 0, runtime.updatedAt),
                sourcePageType: runtime.sourcePageType || existing?.sourcePageType || "unknown",
                imageEnabled: runtime.imageEnabled,
                sources: existing ? Array.from(new Set([...existing.sources, "runtime"])) : ["runtime"],
                status: existing ? mergeStatus(existing.status, runtime.status) : runtime.status,
                hasExportData: runtime.hasExportData,
                isLegacy: existing?.isLegacy || false,
                activeTask: false
            });
        }
    }

    // 导出按结果自身归属列出，不能借用新任务的会话标记
    const data = state.cachedData;
    const context = data?.exportContext;
    if (data && context) {
        const existing = result.get(context.bookId);
        const count = data.chapters.length;
        const hasTaskInventory =
            existing && (existing.sources.includes("runtime") || activeLockByBookId.has(context.bookId));
        result.set(context.bookId, {
            bookId: context.bookId,
            bookName: existing?.bookName || context.rawBookName || data.metadata.title,
            ...(context.rawBookName ? { rawBookName: context.rawBookName } : {}),
            author: existing?.author || data.metadata.author,
            pageUrl: existing?.pageUrl || context.pageUrl,
            totalChapters: existing?.totalChapters || context.selection?.sourceTotalChapters || count,
            progressCount: hasTaskInventory ? existing.progressCount : Math.max(existing?.progressCount || 0, count),
            persistentChapterCount: existing?.persistentChapterCount || 0,
            runtimeChapterCount: hasTaskInventory
                ? existing.runtimeChapterCount
                : Math.max(existing?.runtimeChapterCount || 0, count),
            runtimeCompletedCount: existing?.runtimeCompletedCount || 0,
            updatedAt: existing?.updatedAt || Date.now(),
            sourcePageType: context.sourcePageType,
            imageEnabled: existing?.imageEnabled ?? context.imageEnabled,
            sources: Array.from(new Set([...(existing?.sources || []), "runtime"])),
            status: existing ? mergeStatus(existing.status, "export-ready") : "export-ready",
            hasExportData: true,
            isLegacy: existing?.isLegacy || false,
            activeTask: false
        });
    }

    // 活动锁最终覆盖任务状态，避免把下载中的条目标记为普通缓存
    activeLocks.forEach((lock) => {
        const existing = result.get(lock.bookId);
        const rawBookName = existing?.rawBookName;
        result.set(lock.bookId, {
            bookId: lock.bookId,
            bookName: existing?.bookName || lock.bookName || `Book ${lock.bookId}`,
            ...(rawBookName ? { rawBookName } : {}),
            author: existing?.author || "-",
            pageUrl: existing?.pageUrl || "",
            totalChapters: existing?.totalChapters || null,
            progressCount: existing?.progressCount || 0,
            persistentChapterCount: existing?.persistentChapterCount || 0,
            runtimeChapterCount: existing?.runtimeChapterCount || 0,
            runtimeCompletedCount: existing?.runtimeCompletedCount || 0,
            updatedAt: Math.max(existing?.updatedAt || 0, lock.heartbeatAt),
            sourcePageType: existing?.sourcePageType || lock.sourcePageType,
            imageEnabled: existing?.imageEnabled ?? null,
            sources: existing?.sources || [],
            status: "downloading",
            hasExportData: existing?.hasExportData || false,
            isLegacy: existing?.isLegacy || false,
            activeTask: true
        });
    });

    return Array.from(result.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 按范围清理指定书籍缓存
 * 活动任务保护中的书籍不会被清理
 */
export async function clearManagedCache(bookId: string, scope: CacheClearScope): Promise<CacheClearResult> {
    if (await getActiveBookDownloadLock(bookId)) {
        return { protectedBookIds: [bookId] };
    }

    if (scope === "indexeddb" || scope === "all") {
        const cleared = await clearBookCache(bookId);
        if (!cleared) {
            return { protectedBookIds: [bookId] };
        }
    }

    if (scope === "runtime" || scope === "all") {
        clearRuntimeCacheSession(bookId);
        clearCachedExport(bookId);
    }

    return { protectedBookIds: [] };
}

/**
 * 清理全部未受活动任务保护的缓存
 */
export async function clearAllManagedCaches(includeRuntime: boolean): Promise<CacheClearResult> {
    const activeLocks = await listActiveBookDownloadLocks();
    const protectedBookIds = new Set(activeLocks.map((lock) => lock.bookId));
    const newlyProtected = await clearAllPersistentCaches(protectedBookIds);
    newlyProtected.forEach((bookId) => protectedBookIds.add(bookId));

    const runtimeBookId = state.runtimeCacheSession?.bookId;
    if (includeRuntime) {
        if (!runtimeBookId || !protectedBookIds.has(runtimeBookId)) {
            clearRuntimeCacheSession();
        }
        const exportBookId = state.cachedData?.exportContext?.bookId;
        if (!exportBookId || !protectedBookIds.has(exportBookId)) {
            clearCachedExport();
        }
    }

    return { protectedBookIds: Array.from(protectedBookIds) };
}

/**
 * 请求活动任务停止并清理其缓存
 */
export async function stopAndClearManagedCache(bookId: string): Promise<StopAndClearResult> {
    const request = await requestBookDownloadCancellation(bookId, true);
    if (!request.requested) {
        return { requested: false, cleared: false, status: "not-active" };
    }

    const result = await waitForBookDownloadCancellation(bookId, request.taskId);
    if (result.status === "released") {
        return {
            requested: true,
            cleared: result.cacheCleared,
            status: result.cacheCleared ? "cleared" : "cleanup-failed"
        };
    }
    return { requested: true, cleared: false, status: result.status };
}
