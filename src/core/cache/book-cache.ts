import type { BookCover, CacheMeta, Chapter, PersistentCacheEntry } from "../../types";
import { log } from "../../utils/index";
import { hasBookDownloadTaskPresence, listActiveBookDownloadLocks } from "../book-lock";
import { resetGlobalState, state } from "../state";
import {
    claimCacheV3,
    clearCacheV3,
    clearCacheV3ForTask,
    listCacheManifestsV3,
    putCacheBatchV3,
    putCacheCoverV3ForTask,
    readCacheChaptersV3,
    readCacheCoverV3,
    readCacheManifestV3,
    type CacheManifestV3
} from "./indexeddb-repository";
import {
    deleteLegacyCache,
    getLegacyCacheBookId,
    listLegacyCacheRecords,
    readLegacyCache,
    type LegacyCacheRecord,
    type LegacyStoredCache
} from "./legacy-cache";
import { publishCacheSyncEvent } from "./sync";
import { isExpectedStorageCancellation, normalizeStorageError } from "./storage-error";
import type { ImageCacheCompatibility } from "./image-cache-compatibility";

const CACHE_EXPIRE_TIME = 24 * 60 * 60 * 1000;

export interface BookCacheLoadResult {
    size: number;
    map: Map<number, Chapter> | null;
    meta?: CacheMeta;
}

export interface BookCacheClaimResult extends BookCacheLoadResult {
    compatibility: ImageCacheCompatibility;
    invalidatedCount: number;
}

function isExpired(data: { ts: number }): boolean {
    return Date.now() - data.ts > CACHE_EXPIRE_TIME;
}

function isReusableLegacyCache(data: LegacyStoredCache | undefined): data is LegacyStoredCache {
    return Boolean(data && !data.cleared && !isExpired(data) && Array.isArray(data.chapters));
}

function isReusableV3Cache(data: CacheManifestV3 | undefined): data is CacheManifestV3 {
    return Boolean(data && data.version === 3 && !data.cleared && !isExpired(data));
}

async function deleteLegacyCacheAfterMigration(bookId: string): Promise<void> {
    try {
        await deleteLegacyCache(bookId);
    } catch (error) {
        // v3 已提交时保留可重复清理的旧缓存，不回滚新缓存
        console.warn("清理旧版缓存失败，将在后续操作中重试", error);
    }
}

function toV3PersistentEntry(data: CacheManifestV3): PersistentCacheEntry {
    return {
        key: `v3:${data.bookId}`,
        bookId: data.bookId,
        updatedAt: data.meta?.updatedAt || data.ts,
        chapterCount: data.chapterCount,
        totalChapters: data.meta?.totalChapters ?? null,
        meta: data.meta || null,
        writerTaskId: data.writerTaskId,
        isLegacy: false
    };
}

function toLegacyPersistentEntry(record: LegacyCacheRecord): PersistentCacheEntry | null {
    const { key, data } = record;
    if (!isReusableLegacyCache(data)) {
        return null;
    }

    const bookId = data.meta?.bookId || getLegacyCacheBookId(key);
    return {
        key,
        bookId,
        updatedAt: data.meta?.updatedAt || data.ts,
        chapterCount: data.chapters.length,
        totalChapters: data.meta?.totalChapters ?? null,
        meta: data.meta || null,
        writerTaskId: data.writerTaskId,
        isLegacy: !data.meta
    };
}

/**
 * 读取 IndexedDB 中的小说缓存
 * v3 缓存优先，未迁移时只读 v2 缓存
 */
export async function loadBookCache(bookId: string): Promise<BookCacheLoadResult> {
    try {
        const manifest = await readCacheManifestV3(bookId);
        if (manifest) {
            if (!isReusableV3Cache(manifest)) {
                return { size: 0, map: null };
            }
            const map = await readCacheChaptersV3(bookId);
            console.log(`✅ 读取到本地缓存，章节数：${map.size}`);
            return { size: map.size, map: map.size > 0 ? map : null, meta: manifest.meta };
        }

        const legacy = await readLegacyCache(bookId);
        if (!legacy || legacy.data.cleared) {
            return { size: 0, map: null };
        }
        if (isExpired(legacy.data)) {
            console.warn("⚠ 本地缓存已过期，本次不再使用");
            return { size: 0, map: null };
        }

        const map = new Map<number, Chapter>(legacy.data.chapters);
        console.log(`✅ 读取到本地缓存，章节数：${map.size}`);
        return { size: map.size, map: map.size > 0 ? map : null, meta: legacy.data.meta };
    } catch (error) {
        console.error("读取缓存失败", error);
        throw normalizeStorageError(error, "read");
    }
}

/**
 * 由已取得下载锁的任务原子认领 v3 缓存写入权
 * 首次认领时惰性迁移可用的 v2 缓存
 */
export async function claimBookCache(
    bookId: string,
    taskId: string,
    requestedImageEnabled: boolean,
    signal?: AbortSignal
): Promise<BookCacheClaimResult> {
    try {
        const legacy = await readLegacyCache(bookId);
        const migrationSource = isReusableLegacyCache(legacy?.data)
            ? { chapters: legacy.data.chapters, meta: legacy.data.meta }
            : null;
        const attemptCount = migrationSource ? 2 : 1;
        let claimResult: Awaited<ReturnType<typeof claimCacheV3>> | null = null;
        for (let attempt = 1; attempt <= attemptCount; attempt++) {
            try {
                claimResult = await claimCacheV3(
                    bookId,
                    taskId,
                    migrationSource,
                    CACHE_EXPIRE_TIME,
                    requestedImageEnabled,
                    signal
                );
                break;
            } catch (error) {
                if (isExpectedStorageCancellation(error, signal)) {
                    throw error;
                }
                if (attempt < attemptCount) {
                    console.warn("旧版缓存迁移失败，正在进行一次安全重试", error);
                    continue;
                }
                throw normalizeStorageError(error, migrationSource ? "migrate" : "claim", {
                    migration: Boolean(migrationSource)
                });
            }
        }
        if (!claimResult) {
            throw new Error("缓存认领未返回兼容性结果");
        }
        await deleteLegacyCacheAfterMigration(bookId);
        publishCacheSyncEvent({ type: "cache-claimed", bookId, taskId });

        const map = await readCacheChaptersV3(bookId);
        return {
            size: map.size,
            map: map.size > 0 ? map : null,
            compatibility: claimResult.compatibility,
            invalidatedCount: claimResult.invalidatedCount
        };
    } catch (error) {
        if (isExpectedStorageCancellation(error, signal)) {
            throw error;
        }
        const normalized = normalizeStorageError(error, "claim");
        console.error("认领缓存失败", normalized);
        throw normalized;
    }
}

/**
 * 仅允许当前缓存写入任务增量保存章节
 */
export async function putBookCacheBatchForTask(
    bookId: string,
    taskId: string,
    entries: ReadonlyMap<number, Chapter>,
    meta?: CacheMeta,
    signal?: AbortSignal
): Promise<boolean> {
    if (entries.size === 0) {
        return false;
    }

    try {
        const saved = await putCacheBatchV3(bookId, taskId, entries, meta, signal);
        if (saved) {
            publishCacheSyncEvent({ type: "cache-saved", bookId, taskId });
        }
        return saved;
    } catch (error) {
        if (isExpectedStorageCancellation(error, signal)) {
            return false;
        }
        const normalized = normalizeStorageError(error, "write");
        console.error("保存缓存失败", normalized);
        throw normalized;
    }
}

/**
 * 读取与当前 URL 精确匹配的独立封面记录
 */
export async function loadBookCover(bookId: string, coverUrl: string): Promise<BookCover | null> {
    try {
        return await readCacheCoverV3(bookId, coverUrl);
    } catch (error) {
        const normalized = normalizeStorageError(error, "read");
        console.error("读取封面缓存失败", normalized);
        throw normalized;
    }
}

/**
 * 仅允许当前缓存 writer 原子替换该书的封面记录
 */
export async function putBookCoverForTask(
    bookId: string,
    taskId: string,
    coverUrl: string,
    cover: BookCover,
    signal?: AbortSignal
): Promise<boolean> {
    try {
        return await putCacheCoverV3ForTask(bookId, taskId, coverUrl, cover, signal);
    } catch (error) {
        if (isExpectedStorageCancellation(error, signal)) {
            return false;
        }
        const normalized = normalizeStorageError(error, "write");
        console.error("保存封面缓存失败", normalized);
        throw normalized;
    }
}

/**
 * 仅允许当前缓存写入任务清理 v3 章节
 */
export async function clearBookCacheForTask(bookId: string, taskId: string, signal?: AbortSignal): Promise<boolean> {
    try {
        const cleared = await clearCacheV3ForTask(bookId, taskId, signal);
        if (cleared) {
            await deleteLegacyCacheAfterMigration(bookId);
            log("🗑️ 已清理当前下载任务缓存:" + bookId);
            publishCacheSyncEvent({ type: "cache-cleared", bookId });
        }
        return cleared;
    } catch (error) {
        if (isExpectedStorageCancellation(error, signal)) {
            return false;
        }
        const normalized = normalizeStorageError(error, "clear");
        console.error("清理当前下载任务缓存失败", normalized);
        throw normalized;
    }
}

/**
 * 列出所有持久缓存条目
 */
export async function listBookCaches(): Promise<PersistentCacheEntry[]> {
    try {
        const [manifests, legacyRecords] = await Promise.all([listCacheManifestsV3(), listLegacyCacheRecords()]);
        const v3BookIds = new Set(manifests.map((manifest) => manifest.bookId));
        const v3Entries = manifests.filter(isReusableV3Cache).map(toV3PersistentEntry);
        const uniqueLegacyEntries = legacyRecords
            .filter((record) => !v3BookIds.has(getLegacyCacheBookId(record.key)))
            .map(toLegacyPersistentEntry)
            .filter((entry): entry is PersistentCacheEntry => Boolean(entry))
            .reduce((result, entry) => {
                const existing = result.get(entry.bookId);
                if (!existing || entry.updatedAt > existing.updatedAt) {
                    result.set(entry.bookId, entry);
                }
                return result;
            }, new Map<string, PersistentCacheEntry>());

        return [...v3Entries, ...uniqueLegacyEntries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
        console.error("读取缓存列表失败", error);
        return [];
    }
}

/**
 * 清理指定 ID 的缓存
 */
export async function clearBookCache(bookId: string): Promise<boolean> {
    try {
        const legacy = await readLegacyCache(bookId);
        if (legacy?.data.writerTaskId && hasBookDownloadTaskPresence(legacy.data.writerTaskId)) {
            return false;
        }
        if (!(await clearCacheV3(bookId, hasBookDownloadTaskPresence))) {
            return false;
        }

        await deleteLegacyCacheAfterMigration(bookId);
        log("🗑️ 已清理本地缓存:" + bookId);
        publishCacheSyncEvent({ type: "cache-cleared", bookId });
        return true;
    } catch (error) {
        console.error("清理缓存失败", error);
        return false;
    }
}

async function listStoredBookIds(): Promise<string[]> {
    const [manifests, legacyRecords] = await Promise.all([listCacheManifestsV3(), listLegacyCacheRecords()]);
    return Array.from(
        new Set([
            // cleared manifest 是阻止旧 v2 缓存回流的墓碑，不应重复作为可清理书籍列举
            ...manifests.filter((manifest) => !manifest.cleared).map((manifest) => manifest.bookId),
            ...legacyRecords.map((record) => getLegacyCacheBookId(record.key))
        ])
    );
}

/**
 * 仅清理 IndexedDB 中的全部持久缓存
 */
export async function clearAllPersistentCaches(protectedBookIds: ReadonlySet<string> = new Set()): Promise<string[]> {
    try {
        const targetBookIds = (await listStoredBookIds()).filter((bookId) => !protectedBookIds.has(bookId));
        const results = await Promise.all(
            targetBookIds.map(async (bookId) => ({ bookId, cleared: await clearBookCache(bookId) }))
        );
        const newlyProtected = results.filter((result) => !result.cleared).map((result) => result.bookId);
        console.log(
            "已清理持久缓存:",
            results.filter((result) => result.cleared).map((result) => result.bookId)
        );
        return newlyProtected;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("清理缓存失败", error);
        alert("清理失败: " + message);
        return [];
    }
}

/**
 * 清理全部缓存，包括持久缓存和当前页内存状态
 */
export async function clearAllCaches(): Promise<{ protectedBookIds: string[] }> {
    const activeLocks = await listActiveBookDownloadLocks();
    const protectedBookIds = new Set(activeLocks.map((lock) => lock.bookId));
    const newlyProtected = await clearAllPersistentCaches(protectedBookIds);
    newlyProtected.forEach((bookId) => protectedBookIds.add(bookId));

    const runtimeBookId = state.runtimeCacheSession?.bookId;
    if (!runtimeBookId || !protectedBookIds.has(runtimeBookId)) {
        resetGlobalState();
    }

    return { protectedBookIds: Array.from(protectedBookIds) };
}
