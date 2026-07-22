import { CacheListItem, CacheStatus, PersistentCacheEntry } from "../types";
import { clearRuntimeCacheSession, state } from "./state";
import { clearAllPersistentCaches, clearBookCache, listBookCaches } from "./storage";
import {
    getActiveBookDownloadLock,
    listActiveBookDownloadLocks,
    requestBookDownloadCancellation,
    waitForBookDownloadCancellation
} from "./book-lock";

export type CacheClearScope = "indexeddb" | "runtime" | "all";

export interface CacheClearResult {
    protectedBookIds: string[];
}

export interface StopAndClearResult {
    requested: boolean;
    cleared: boolean;
    status: "not-active" | "cleared" | "cleanup-failed" | "replaced" | "stale" | "timeout";
}

function createPersistentListItem(entry: PersistentCacheEntry): CacheListItem {
    return {
        bookId: entry.bookId,
        bookName: entry.meta?.rawBookName || entry.meta?.bookName || `Book ${entry.bookId}`,
        rawBookName: entry.meta?.rawBookName,
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
    const priority: Record<CacheStatus, number> = {
        downloading: 4,
        "export-ready": 3,
        cancelled: 2,
        persisted: 1
    };

    return priority[next] > priority[current] ? next : current;
}

export async function listManagedCaches(): Promise<CacheListItem[]> {
    const persistentEntries = await listBookCaches();
    const result = new Map<string, CacheListItem>();

    persistentEntries.forEach((entry) => {
        result.set(entry.bookId, createPersistentListItem(entry));
    });

    const runtime = state.runtimeCacheSession;
    if (runtime) {
        const existing = result.get(runtime.bookId);
        const mergedSources = existing ? [...existing.sources] : [];
        if (!mergedSources.includes("runtime")) {
            mergedSources.push("runtime");
        }

        const persistentChapterCount = existing?.persistentChapterCount || 0;
        const progressCount = Math.max(runtime.completedCount, runtime.cachedChapterCount, persistentChapterCount);

        result.set(runtime.bookId, {
            bookId: runtime.bookId,
            bookName: runtime.rawBookName || runtime.bookName || existing?.bookName || `Book ${runtime.bookId}`,
            rawBookName: runtime.rawBookName || existing?.rawBookName,
            author: runtime.author || existing?.author || "-",
            pageUrl: runtime.pageUrl || existing?.pageUrl || "",
            totalChapters: runtime.totalChapters || existing?.totalChapters || null,
            progressCount,
            persistentChapterCount,
            runtimeChapterCount: runtime.cachedChapterCount,
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

    const activeLocks = await listActiveBookDownloadLocks();
    activeLocks.forEach((lock) => {
        const existing = result.get(lock.bookId);
        result.set(lock.bookId, {
            bookId: lock.bookId,
            bookName: existing?.bookName || lock.bookName || `Book ${lock.bookId}`,
            rawBookName: existing?.rawBookName,
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
    }

    return { protectedBookIds: [] };
}

export async function clearAllManagedCaches(includeRuntime: boolean): Promise<CacheClearResult> {
    const activeLocks = await listActiveBookDownloadLocks();
    const protectedBookIds = new Set(activeLocks.map((lock) => lock.bookId));
    const newlyProtected = await clearAllPersistentCaches(protectedBookIds);
    newlyProtected.forEach((bookId) => protectedBookIds.add(bookId));

    const runtimeBookId = state.runtimeCacheSession?.bookId;
    if (includeRuntime && (!runtimeBookId || !protectedBookIds.has(runtimeBookId))) {
        clearRuntimeCacheSession();
    }

    return { protectedBookIds: Array.from(protectedBookIds) };
}

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
