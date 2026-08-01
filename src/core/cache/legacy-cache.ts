import { del, get, keys } from "idb-keyval";
import type { CacheMeta, Chapter } from "../../types";

/**
 * v2 及更早版本的整本缓存记录
 */
export interface LegacyStoredCache {
    version?: number;
    ts: number;
    chapters: [number, Chapter][];
    meta?: CacheMeta;
    writerTaskId?: string;
    cleared?: boolean;
}

/**
 * 旧缓存键及其记录
 */
export interface LegacyCacheRecord {
    key: string;
    data: LegacyStoredCache;
}

const CACHE_PREFIX = "esj_down_book_";
const LEGACY_CACHE_PREFIX = "esj_down_";
const HISTORY_KEY = "esj_down_history";

function getCacheKey(bookId: string): string {
    return CACHE_PREFIX + bookId;
}

function getLegacyCacheKey(bookId: string): string {
    return LEGACY_CACHE_PREFIX + bookId;
}

function isLegacyCacheKey(key: string): boolean {
    return key.startsWith(CACHE_PREFIX) || (key.startsWith(LEGACY_CACHE_PREFIX) && key !== HISTORY_KEY);
}

/**
 * 从旧缓存键解析书籍 ID
 */
export function getLegacyCacheBookId(key: string): string {
    return key.startsWith(CACHE_PREFIX) ? key.slice(CACHE_PREFIX.length) : key.slice(LEGACY_CACHE_PREFIX.length);
}

/**
 * 按新旧键优先级读取指定书籍的旧缓存
 */
export async function readLegacyCache(bookId: string): Promise<LegacyCacheRecord | null> {
    const currentKey = getCacheKey(bookId);
    const current = await get<LegacyStoredCache>(currentKey);
    if (current) {
        return { key: currentKey, data: current };
    }

    const legacyKey = getLegacyCacheKey(bookId);
    const legacy = await get<LegacyStoredCache>(legacyKey);
    return legacy ? { key: legacyKey, data: legacy } : null;
}

/**
 * 列出默认存储中的全部旧缓存记录
 */
export async function listLegacyCacheRecords(): Promise<LegacyCacheRecord[]> {
    const targetKeys = (await keys<IDBValidKey>()).map(String).filter(isLegacyCacheKey);
    const records = await Promise.all(
        targetKeys.map(async (key) => {
            const data = await get<LegacyStoredCache>(key);
            return data ? { key, data } : null;
        })
    );
    return records.filter((record): record is LegacyCacheRecord => Boolean(record));
}

/**
 * 删除指定书籍的全部旧缓存键
 */
export async function deleteLegacyCache(bookId: string): Promise<void> {
    await Promise.all([del(getCacheKey(bookId)), del(getLegacyCacheKey(bookId))]);
}
