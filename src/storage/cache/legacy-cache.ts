import { createStore, get, keys } from "idb-keyval";
import type { CacheMeta } from "./model";
import type { Chapter } from "../../content/model";
import { hasBookDownloadTaskPresence } from "../book-lock";

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
 * 列出默认存储中的全部旧缓存记录
 */
export async function listLegacyCacheRecords(): Promise<LegacyCacheRecord[]> {
    const targetKeys = (await keys<IDBValidKey>(legacyStore)).map(String).filter(isLegacyCacheKey);
    const records = await Promise.all(
        targetKeys.map(async (key) => {
            const data = await get<LegacyStoredCache>(key, legacyStore);
            return data ? { key, data } : null;
        })
    );
    return records.filter((record): record is LegacyCacheRecord => Boolean(record));
}

/**
 * 仅在两个旧键均无其他活动写入者时允许清理，删除前在同一事务内复核
 */
export function clearLegacyCacheIfInactive(
    bookId: string,
    action: "check" | "clear",
    ownTaskId?: string
): Promise<boolean> {
    return legacyStore(
        action === "check" ? "readonly" : "readwrite",
        (store) =>
            new Promise<boolean>((resolve, reject) => {
                const transaction = store.transaction;
                const cacheKeys = [getCacheKey(bookId), getLegacyCacheKey(bookId)];
                let allowed = false;
                let operationError: unknown;
                transaction.oncomplete = () => resolve(allowed);
                transaction.onabort = () =>
                    reject(operationError ?? transaction.error ?? new DOMException("旧缓存事务已中止", "AbortError"));
                const requests = cacheKeys.map((key): IDBRequest<LegacyStoredCache | undefined> => store.get(key));

                // 同一事务的请求按入队顺序执行，最后一次读成功后才能决定两个键是否一起删除
                requests[1].onsuccess = () => {
                    try {
                        for (const request of requests) {
                            const writer = request.result?.writerTaskId;
                            if (writer && writer !== ownTaskId && hasBookDownloadTaskPresence(writer)) {
                                return;
                            }
                        }
                        if (action === "clear") {
                            for (const key of cacheKeys) {
                                store.delete(key);
                            }
                        }
                        allowed = true;
                    } catch (error) {
                        operationError = error;
                        transaction.abort();
                    }
                };
            })
    );
}
