import { del, get, keys, update } from "idb-keyval";
import { CacheMeta, Chapter, PersistentCacheEntry } from "../types";
import { log } from "../utils/index";
import { resetGlobalState, state } from "./state";
import { hasBookDownloadTaskPresence, listActiveBookDownloadLocks } from "./book-lock";

interface StoredCache {
    version?: number;
    ts: number;
    chapters: [number, Chapter][];
    meta?: CacheMeta;
    writerTaskId?: string;
    cleared?: boolean;
}

// 下载缓存配置，24h过期
const CACHE_PREFIX = "esj_down_book_";
const LEGACY_CACHE_PREFIX = "esj_down_";
const HISTORY_KEY = "esj_down_history";
const CACHE_EXPIRE_TIME = 24 * 60 * 60 * 1000;

function getCacheKey(bookId: string): string {
    return CACHE_PREFIX + bookId;
}

function getLegacyCacheKey(bookId: string): string {
    return LEGACY_CACHE_PREFIX + bookId;
}

function isCacheKey(key: string): boolean {
    return key.startsWith(CACHE_PREFIX) || (key.startsWith(LEGACY_CACHE_PREFIX) && key !== HISTORY_KEY);
}

function getBookIdFromKey(key: string): string {
    return key.startsWith(CACHE_PREFIX) ? key.slice(CACHE_PREFIX.length) : key.slice(LEGACY_CACHE_PREFIX.length);
}

function isExpired(data: StoredCache): boolean {
    return Date.now() - data.ts > CACHE_EXPIRE_TIME;
}

function normalizeMeta(bookId: string, meta?: CacheMeta): CacheMeta | undefined {
    if (!meta) {
        return undefined;
    }

    return {
        ...meta,
        bookId,
        updatedAt: Date.now()
    };
}

function toPersistentEntry(key: string, data: StoredCache): PersistentCacheEntry | null {
    if (data.cleared || !Array.isArray(data.chapters)) {
        return null;
    }

    const map = new Map<number, Chapter>(data.chapters);
    const bookId = data.meta?.bookId || getBookIdFromKey(key);

    return {
        key,
        bookId,
        updatedAt: data.meta?.updatedAt || data.ts,
        chapterCount: map.size,
        totalChapters: data.meta?.totalChapters ?? null,
        map,
        meta: data.meta || null,
        isLegacy: !data.meta
    };
}

/**
 * 读取 IndexedDB 中的小说缓存
 * @param bookId
 * @returns 缓存数据和章节数量
 */
export async function loadBookCache(bookId: string): Promise<{ size: number; map: Map<number, Chapter> | null }> {
    const key = getCacheKey(bookId);
    try {
        let data = await get<StoredCache>(key);
        const legacyKey = getLegacyCacheKey(bookId);
        if (!data) {
            data = await get<StoredCache>(legacyKey);
        }
        if (!data) {
            return { size: 0, map: null };
        }

        if (data.cleared) {
            return { size: 0, map: null };
        }

        if (isExpired(data)) {
            console.warn("⚠ 本地缓存已过期，本次不再使用");
            return { size: 0, map: null };
        }

        if (Array.isArray(data.chapters)) {
            const map = new Map<number, Chapter>(data.chapters);
            console.log(`✅ 读取到本地缓存，章节数：${map.size}`);
            return { size: map.size, map };
        }
    } catch (e) {
        console.error("读取缓存失败", e);
    }

    return { size: 0, map: null };
}

/**
 * 由已取得下载锁的任务原子认领缓存写入权。
 */
export async function claimBookCache(
    bookId: string,
    taskId: string
): Promise<{ size: number; map: Map<number, Chapter> | null }> {
    const key = getCacheKey(bookId);
    const legacyKey = getLegacyCacheKey(bookId);
    try {
        const legacyData = await get<StoredCache>(legacyKey);
        let claimed: StoredCache | null = null;

        await update<StoredCache | undefined>(key, (current) => {
            const source = current || legacyData;
            const reusable = Boolean(source && !source.cleared && !isExpired(source) && Array.isArray(source.chapters));
            claimed = {
                version: 2,
                ts: Date.now(),
                chapters: reusable ? source!.chapters : [],
                meta: reusable ? source!.meta : undefined,
                writerTaskId: taskId,
                cleared: false
            };
            return claimed;
        });

        if (legacyData) {
            await del(legacyKey);
        }

        const claimedCache = claimed as StoredCache | null;
        const chapters = claimedCache?.chapters || [];
        const map = new Map<number, Chapter>(chapters);
        return { size: map.size, map: map.size > 0 ? map : null };
    } catch (error) {
        console.error("认领缓存失败", error);
        throw error;
    }
}

/**
 * 仅允许当前缓存写入任务保存章节。
 * @param bookId
 * @param map 章节数据
 */
export async function saveBookCacheForTask(
    bookId: string,
    taskId: string,
    map: Map<number, Chapter>,
    meta?: CacheMeta
): Promise<boolean> {
    const normalizedMeta = normalizeMeta(bookId, meta);
    const data: StoredCache = {
        version: 2,
        ts: normalizedMeta?.updatedAt || Date.now(),
        chapters: Array.from(map.entries()),
        meta: normalizedMeta,
        writerTaskId: taskId,
        cleared: false
    };
    let saved = false;

    try {
        await update<StoredCache | undefined>(getCacheKey(bookId), (current) => {
            if (!current || current.writerTaskId !== taskId || current.cleared) {
                return current;
            }
            saved = true;
            return data;
        });
    } catch (e) {
        console.error("保存缓存失败", e);
    }
    return saved;
}

/**
 * 仅允许当前缓存写入任务清理章节，并保留所有权墓碑阻止旧任务复写。
 */
export async function clearBookCacheForTask(bookId: string, taskId: string): Promise<boolean> {
    let cleared = false;
    try {
        await update<StoredCache | undefined>(getCacheKey(bookId), (current) => {
            if (!current || current.writerTaskId !== taskId) {
                return current;
            }
            cleared = true;
            return {
                ...current,
                version: 2,
                ts: Date.now(),
                chapters: [],
                writerTaskId: taskId,
                cleared: true
            };
        });
        if (cleared) {
            await del(getLegacyCacheKey(bookId));
            log("🗑️ 已清理当前下载任务缓存:" + bookId);
        }
    } catch (error) {
        console.error("清理当前下载任务缓存失败", error);
        return false;
    }
    return cleared;
}

/**
 * 列出所有持久缓存条目
 */
export async function listBookCaches(): Promise<PersistentCacheEntry[]> {
    try {
        const allKeys = await keys();
        const targetKeys = allKeys.map((key) => String(key)).filter(isCacheKey);

        const entries = await Promise.all(
            targetKeys.map(async (key) => {
                const data = await get<StoredCache>(key);
                if (!data) {
                    return null;
                }

                if (isExpired(data)) {
                    return null;
                }

                return toPersistentEntry(key, data);
            })
        );

        const uniqueEntries = entries
            .filter((entry): entry is PersistentCacheEntry => Boolean(entry))
            .reduce((result, entry) => {
                const existing = result.get(entry.bookId);
                if (!existing || entry.updatedAt > existing.updatedAt) {
                    result.set(entry.bookId, entry);
                }
                return result;
            }, new Map<string, PersistentCacheEntry>());

        return Array.from(uniqueEntries.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (e) {
        console.error("读取缓存列表失败", e);
        return [];
    }
}

/**
 * 清理指定 ID 的缓存
 * @param bookId
 */
export async function clearBookCache(bookId: string): Promise<boolean> {
    try {
        let protectedByTask = false;
        await update<StoredCache | undefined>(getCacheKey(bookId), (current) => {
            if (current?.writerTaskId && hasBookDownloadTaskPresence(current.writerTaskId)) {
                protectedByTask = true;
                return current;
            }
            return {
                version: 2,
                ts: Date.now(),
                chapters: [],
                cleared: true
            };
        });
        if (protectedByTask) {
            return false;
        }
        await del(getLegacyCacheKey(bookId));
        log("🗑️ 已清理本地缓存:" + bookId);
        return true;
    } catch (e) {
        console.error("清理缓存失败", e);
        return false;
    }
}

/**
 * 仅清理 IndexedDB 中的全部持久缓存
 */
export async function clearAllPersistentCaches(protectedBookIds: ReadonlySet<string> = new Set()): Promise<string[]> {
    try {
        const allKeys = await keys();
        const targetBookIds = Array.from(
            new Set(
                allKeys
                    .map((key) => String(key))
                    .filter(isCacheKey)
                    .map(getBookIdFromKey)
                    .filter((bookId) => !protectedBookIds.has(bookId))
            )
        );
        const results = await Promise.all(
            targetBookIds.map(async (bookId) => ({ bookId, cleared: await clearBookCache(bookId) }))
        );
        const newlyProtected = results.filter((result) => !result.cleared).map((result) => result.bookId);
        console.log(
            "已清理持久缓存:",
            results.filter((result) => result.cleared).map((result) => result.bookId)
        );
        return newlyProtected;
    } catch (e: any) {
        console.error("清理缓存失败", e);
        alert("清理失败: " + e.message);
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
