import { del, get, keys, set } from "idb-keyval";
import { CacheMeta, Chapter, PersistentCacheEntry } from "../types";
import { log } from "../utils/index";
import { resetGlobalState, state } from "./state";
import { listActiveBookDownloadLocks } from "./book-lock";

interface StoredCache {
    version?: number;
    ts: number;
    chapters: [number, Chapter][];
    meta?: CacheMeta;
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
    if (!Array.isArray(data.chapters)) {
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
        let loadedLegacy = false;
        const legacyKey = getLegacyCacheKey(bookId);
        if (!data) {
            data = await get<StoredCache>(legacyKey);
            loadedLegacy = Boolean(data);
        }
        if (!data) {
            return { size: 0, map: null };
        }

        if (isExpired(data)) {
            console.warn("⚠ 本地缓存已过期，自动清理");
            await del(loadedLegacy ? legacyKey : key);
            return { size: 0, map: null };
        }

        if (Array.isArray(data.chapters)) {
            const map = new Map<number, Chapter>(data.chapters);
            if (loadedLegacy) {
                await set(key, data);
                await del(legacyKey);
            }
            console.log(`✅ 读取到本地缓存，章节数：${map.size}`);
            return { size: map.size, map };
        }
    } catch (e) {
        console.error("读取缓存失败", e);
    }

    return { size: 0, map: null };
}

/**
 * 保存章节缓存到 IndexedDB
 * @param bookId
 * @param map 章节数据
 */
export async function saveBookCache(bookId: string, map: Map<number, Chapter>, meta?: CacheMeta) {
    const normalizedMeta = normalizeMeta(bookId, meta);
    const data: StoredCache = {
        version: normalizedMeta ? 1 : undefined,
        ts: normalizedMeta?.updatedAt || Date.now(),
        chapters: Array.from(map.entries()),
        meta: normalizedMeta
    };

    try {
        await set(getCacheKey(bookId), data);
    } catch (e) {
        console.error("保存缓存失败", e);
    }
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
                    await del(key);
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
export async function clearBookCache(bookId: string) {
    try {
        await Promise.all([del(getCacheKey(bookId)), del(getLegacyCacheKey(bookId))]);
        log("🗑️ 已清理本地缓存:" + bookId);
    } catch (e) {
        console.error("清理缓存失败", e);
    }
}

/**
 * 仅清理 IndexedDB 中的全部持久缓存
 */
export async function clearAllPersistentCaches(protectedBookIds: ReadonlySet<string> = new Set()): Promise<void> {
    try {
        const allKeys = await keys();
        const targetKeys = allKeys.filter((key) => {
            const cacheKey = String(key);
            return isCacheKey(cacheKey) && !protectedBookIds.has(getBookIdFromKey(cacheKey));
        });
        await Promise.all(targetKeys.map((k) => del(k)));
        console.log("已清理持久缓存:", targetKeys);
    } catch (e: any) {
        console.error("清理缓存失败", e);
        alert("清理失败: " + e.message);
    }
}

/**
 * 清理全部缓存，包括持久缓存和当前页内存状态
 */
export async function clearAllCaches(): Promise<{ protectedBookIds: string[] }> {
    const activeLocks = await listActiveBookDownloadLocks();
    const protectedBookIds = new Set(activeLocks.map((lock) => lock.bookId));
    await clearAllPersistentCaches(protectedBookIds);

    const runtimeBookId = state.runtimeCacheSession?.bookId;
    if (!runtimeBookId || !protectedBookIds.has(runtimeBookId)) {
        resetGlobalState();
    }

    return { protectedBookIds: Array.from(protectedBookIds) };
}
