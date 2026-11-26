import { createStore, get, keys } from "idb-keyval";
import type { CacheMeta } from "./model";
import type { Chapter } from "../../content/model";

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

// 旧版页面通过 idb-keyval 的默认连接读写这两个缓存键
const legacyStore = createStore("keyval-store", "keyval");

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
    const current = await get<LegacyStoredCache>(currentKey, legacyStore);
    if (current) {
        return { key: currentKey, data: current };
    }

    const legacyKey = getLegacyCacheKey(bookId);
    const legacy = await get<LegacyStoredCache>(legacyKey, legacyStore);
    return legacy ? { key: legacyKey, data: legacy } : null;
}

/**
 * 列出旧缓存键，批量清理不需要加载正文
 */
export async function listLegacyCacheKeys(): Promise<string[]> {
    return (await keys<IDBValidKey>(legacyStore)).map(String).filter(isLegacyCacheKey);
}

/**
 * 列出默认存储中的全部旧缓存记录
 */
export async function listLegacyCacheRecords(): Promise<LegacyCacheRecord[]> {
    const targetKeys = await listLegacyCacheKeys();
    const records = await Promise.all(
        targetKeys.map(async (key) => {
            const data = await get<LegacyStoredCache>(key, legacyStore);
            return data ? { key, data } : null;
        })
    );
    return records.filter((record): record is LegacyCacheRecord => Boolean(record));
}

/**
 * 在同一个旧库事务中删除该书的两个旧缓存键
 */
export function clearLegacyCache(bookId: string): Promise<void> {
    return legacyStore(
        "readwrite",
        (store) =>
            new Promise<void>((resolve, reject) => {
                const transaction = store.transaction;
                let operationError: unknown;
                transaction.oncomplete = () => resolve();
                transaction.onabort = () =>
                    reject(operationError ?? transaction.error ?? new DOMException("旧缓存事务已中止", "AbortError"));
                try {
                    store.delete(getCacheKey(bookId));
                    store.delete(getLegacyCacheKey(bookId));
                } catch (error) {
                    operationError = error;
                    transaction.abort();
                }
            })
    );
}
