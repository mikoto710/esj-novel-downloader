import { CacheListItem, CacheStatus, PersistentCacheEntry } from "../types";
import { clearRuntimeCacheSession, state } from "./state";
import { clearAllPersistentCaches, clearBookCache, listBookCaches } from "./storage";

export type CacheClearScope = "indexeddb" | "runtime" | "all";

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
        isLegacy: entry.isLegacy
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
            isLegacy: existing?.isLegacy || false
        });
    }

    return Array.from(result.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function clearManagedCache(bookId: string, scope: CacheClearScope): Promise<void> {
    if (scope === "indexeddb" || scope === "all") {
        await clearBookCache(bookId);
    }

    if (scope === "runtime" || scope === "all") {
        clearRuntimeCacheSession(bookId);
    }
}

export async function clearAllManagedCaches(includeRuntime: boolean): Promise<void> {
    await clearAllPersistentCaches();

    if (includeRuntime) {
        clearRuntimeCacheSession();
    }
}
