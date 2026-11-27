import type { ChapterCacheSources } from "./chapter-source";
import type { CacheMeta, PersistentCacheEntry } from "./model";
import type { BookCover, Chapter } from "../../content/model";
import { getActiveBookDownloadLock } from "../book-lock";
import {
    claimCacheV3,
    clearCacheV3,
    clearCacheV3ForTask,
    finishCacheV3ForTask,
    listCacheManifestsV3,
    previewCacheV3,
    putCacheBatchV3,
    putCacheCoverV3ForTask,
    readCacheChaptersV3,
    readCacheCoverV3,
    readCacheManifestV3,
    type CacheManifestV3
} from "./indexeddb-repository";
import {
    clearLegacyCache,
    getLegacyCacheBookId,
    listLegacyCacheRecords,
    listLegacyCacheKeys,
    readLegacyCache,
    type LegacyCacheRecord,
    type LegacyStoredCache
} from "./legacy-cache";
import { publishCacheSyncEvent } from "./sync";
import { createStorageError, isExpectedStorageCancellation, normalizeStorageError } from "./storage-error";
import { evaluateImageCacheCompatibility, type ImageCacheCompatibility } from "./compatibility";

const CACHE_EXPIRE_TIME = 24 * 60 * 60 * 1000;

/**
 * 已读取的章节 Map 与数量，无可用章节时 map 为 null
 */
export interface BookCacheLoadResult {
    size: number;
    map: Map<number, Chapter> | null;
    meta?: CacheMeta;
}

/**
 * 缓存章节索引与兼容性预览，valid 不表示插图设置兼容
 */
export interface BookCachePreviewResult {
    valid: boolean;
    // size 保留整书缓存量用于插图设置变更确认；indexes 按当前目录匹配
    size: number;
    indexes: number[];
    meta?: CacheMeta;
    compatibility: ImageCacheCompatibility;
}

export type BookCacheClaimResult =
    | (BookCacheLoadResult & { status: "claimed"; compatibility: ImageCacheCompatibility; invalidatedCount: number })
    | (BookCachePreviewResult & { status: "needs-confirmation" });

/**
 * 缓存认领的清除许可，插图不兼容的缓存只在用户同意后允许清除
 */
export interface BookCacheClaimOptions {
    allowInvalidation?: boolean;
    chapterSources?: ChapterCacheSources;
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
        await clearLegacyCache(bookId);
    } catch (error) {
        console.warn("清理旧版缓存失败，v3 缓存已保存", error);
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
        ...(data.writerTaskId === undefined ? {} : { writerTaskId: data.writerTaskId }),
        isLegacy: false
    };
}

function toLegacyPersistentEntry(record: LegacyCacheRecord): PersistentCacheEntry | null {
    const { key, data } = record;
    if (!isReusableLegacyCache(data)) {
        return null;
    }

    const bookId = getLegacyCacheBookId(key);
    return {
        key,
        bookId,
        updatedAt: data.meta?.updatedAt || data.ts,
        chapterCount: data.chapters.length,
        totalChapters: data.meta?.totalChapters ?? null,
        meta: data.meta || null,
        ...(data.writerTaskId === undefined ? {} : { writerTaskId: data.writerTaskId }),
        isLegacy: !data.meta
    };
}

/**
 * 只读返回未过期缓存的章节索引及插图兼容结果，不认领、迁移或清除缓存
 */
export async function previewBookCache(
    bookId: string,
    requestedImageEnabled: boolean,
    chapterSources?: ChapterCacheSources
): Promise<BookCachePreviewResult> {
    try {
        const { manifest, indexes, size } = await previewCacheV3(bookId, chapterSources);
        if (manifest) {
            if (isReusableV3Cache(manifest)) {
                return {
                    valid: true,
                    size,
                    indexes,
                    ...(manifest.meta === undefined ? {} : { meta: manifest.meta }),
                    compatibility: evaluateImageCacheCompatibility(manifest.meta?.imageEnabled, requestedImageEnabled)
                };
            }
        } else {
            // 旧记录只有整块格式，预览读取但不迁移
            const legacy = await readLegacyCache(bookId);
            if (isReusableLegacyCache(legacy?.data)) {
                const indexes = Array.from(new Set(legacy.data.chapters.map(([index]) => index)));
                return {
                    valid: true,
                    size: indexes.length,
                    indexes: chapterSources ? [] : indexes,
                    ...(legacy.data.meta === undefined ? {} : { meta: legacy.data.meta }),
                    compatibility: evaluateImageCacheCompatibility(
                        legacy.data.meta?.imageEnabled,
                        requestedImageEnabled
                    )
                };
            }
        }
        return { valid: false, size: 0, indexes: [], compatibility: "compatible" };
    } catch (error) {
        throw normalizeStorageError(error, "read");
    }
}

/**
 * 调用方须先持有书籍锁；认领或迁移缓存，未经同意的兼容失效只返回预览
 */
export async function claimBookCache(
    bookId: string,
    taskId: string,
    requestedImageEnabled: boolean,
    signal?: AbortSignal,
    options: BookCacheClaimOptions = {}
): Promise<BookCacheClaimResult> {
    try {
        // 先记住缓存 writer，再查独立锁，防止已排队的认领覆盖后来的 writer
        const manifest = await readCacheManifestV3(bookId);
        const legacy = manifest ? null : await readLegacyCache(bookId);
        const migrationSource = isReusableLegacyCache(legacy?.data)
            ? {
                  chapters: legacy.data.chapters,
                  ...(legacy.data.meta === undefined ? {} : { meta: legacy.data.meta })
              }
            : null;
        const attemptCount = migrationSource ? 2 : 1;
        let claimResult: Awaited<ReturnType<typeof claimCacheV3>> | null = null;
        for (let attempt = 1; attempt <= attemptCount; attempt++) {
            if ((await getActiveBookDownloadLock(bookId))?.taskId !== taskId) {
                throw createStorageError("ownership-lost", "claim");
            }
            try {
                claimResult = await claimCacheV3(
                    bookId,
                    taskId,
                    manifest?.writerTaskId,
                    migrationSource,
                    CACHE_EXPIRE_TIME,
                    requestedImageEnabled,
                    signal,
                    options.allowInvalidation === true
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
        if (claimResult.status === "needs-confirmation") {
            return {
                ...claimResult,
                valid: true,
                size: claimResult.indexes.length,
                indexes: options.chapterSources ? [] : claimResult.indexes
            };
        }
        if (claimResult.status === "ownership-lost") {
            throw createStorageError("ownership-lost", "claim");
        }
        if (legacy) {
            await deleteLegacyCacheAfterMigration(bookId);
        }
        publishCacheSyncEvent({ type: "cache-claimed", bookId, taskId });

        const map = await readCacheChaptersV3(bookId, options.chapterSources, taskId);
        return {
            status: "claimed",
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
    signal?: AbortSignal,
    chapterSources?: ChapterCacheSources
): Promise<boolean> {
    if (entries.size === 0) {
        return false;
    }

    try {
        const saved = await putCacheBatchV3(bookId, taskId, entries, meta, signal, chapterSources);
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
 * 仅允许当前 writer 关闭写入权并保留该书累计缓存
 */
export async function finishBookCacheForTask(
    bookId: string,
    taskId: string,
    meta: CacheMeta,
    signal?: AbortSignal
): Promise<boolean> {
    try {
        return await finishCacheV3ForTask(bookId, taskId, meta, signal);
    } catch (error) {
        if (isExpectedStorageCancellation(error, signal)) {
            return false;
        }
        const normalized = normalizeStorageError(error, "write");
        console.error("关闭当前下载任务缓存 writer 失败", normalized);
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
 * 仅允许当前写入任务清理书籍缓存，旧缓存删除失败时也向任务报告
 */
export async function clearBookCacheForTask(bookId: string, taskId: string, signal?: AbortSignal): Promise<boolean> {
    try {
        if ((await getActiveBookDownloadLock(bookId))?.taskId !== taskId) {
            return false;
        }
        const cleared = await clearCacheV3ForTask(bookId, taskId, signal);
        if (!cleared) {
            return false;
        }
        publishCacheSyncEvent({ type: "cache-cleared", bookId });
        await clearLegacyCache(bookId);
        return true;
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
 * 返回本次读取确认的持久缓存，并标记来源读取失败
 */
export async function listBookCaches(): Promise<{ entries: PersistentCacheEntry[]; incomplete: boolean }> {
    let incomplete = false;
    // 先列出旧记录，后读取 v3 清单，确保旧记录服从已有清除标记
    const legacy = await listLegacyCacheRecords().catch((error) => {
        incomplete = true;
        console.error("读取旧版缓存列表失败", error);
        return [];
    });
    const blockedLegacyBookIds = new Set<string>();
    let manifests: CacheManifestV3[];
    try {
        manifests = await listCacheManifestsV3();
    } catch (error) {
        incomplete = true;
        console.error("读取 v3 缓存列表失败", error);
        manifests = [];
        for (const bookId of new Set(legacy.map(({ key }) => getLegacyCacheBookId(key)))) {
            try {
                const manifest = await readCacheManifestV3(bookId);
                if (manifest) {
                    manifests.push(manifest);
                }
            } catch {
                blockedLegacyBookIds.add(bookId);
            }
        }
    }

    const entries = new Map<string, PersistentCacheEntry>();
    for (const manifest of manifests) {
        blockedLegacyBookIds.add(manifest.bookId);
        if (isReusableV3Cache(manifest)) {
            entries.set(manifest.bookId, toV3PersistentEntry(manifest));
        }
    }
    for (const record of legacy) {
        const entry = toLegacyPersistentEntry(record);
        if (
            entry &&
            !blockedLegacyBookIds.has(entry.bookId) &&
            (entries.get(entry.bookId)?.updatedAt ?? 0) < entry.updatedAt
        ) {
            entries.set(entry.bookId, entry);
        }
    }
    return { entries: Array.from(entries.values()).sort((a, b) => b.updatedAt - a.updatedAt), incomplete };
}

/**
 * 清理指定书籍的新旧缓存，存在活动锁时返回 false，存储失败抛出异常
 */
export async function clearBookCache(bookId: string): Promise<boolean> {
    try {
        const manifest = await readCacheManifestV3(bookId);
        if ((await getActiveBookDownloadLock(bookId)) || !(await clearCacheV3(bookId, manifest?.writerTaskId))) {
            return false;
        }
        publishCacheSyncEvent({ type: "cache-cleared", bookId });
        await clearLegacyCache(bookId);
        return true;
    } catch (error) {
        throw normalizeStorageError(error, "clear");
    }
}

/**
 * 跳过已知保护项，返回清理时发现的受保护书籍 ID；存储失败时等待本轮清理结束后抛出异常
 */
export async function clearAllPersistentCaches(protectedBookIds: ReadonlySet<string> = new Set()): Promise<string[]> {
    try {
        const [manifests, legacy] = await Promise.allSettled([listCacheManifestsV3(), listLegacyCacheKeys()]);
        const bookIds = new Set([
            ...(manifests.status === "fulfilled"
                ? manifests.value.filter((manifest) => !manifest.cleared).map((manifest) => manifest.bookId)
                : []),
            ...(legacy.status === "fulfilled" ? legacy.value.map(getLegacyCacheBookId) : [])
        ]);
        const targets = Array.from(bookIds).filter((bookId) => !protectedBookIds.has(bookId));
        const results = await Promise.allSettled(targets.map(clearBookCache));
        for (const result of [manifests, legacy, ...results]) {
            if (result.status === "rejected") {
                throw result.reason;
            }
        }
        return targets.filter((_, index) => {
            const result = results[index];
            return result.status === "fulfilled" && !result.value;
        });
    } catch (error) {
        console.error("清理缓存失败", error);
        throw normalizeStorageError(error, "clear");
    }
}
