import { createStore, get, promisifyRequest } from "idb-keyval";
import type { BookCover, CacheMeta, Chapter } from "../../types";
import { evaluateImageCacheCompatibility, type ImageCacheCompatibility } from "./image-cache-compatibility";

/**
 * v3 书籍缓存清单
 */
export interface CacheManifestV3 {
    version: 3;
    bookId: string;
    ts: number;
    chapterCount: number;
    meta?: CacheMeta;
    writerTaskId: string;
    writerClosedAt?: number;
    cleared?: boolean;
}

/**
 * 首次创建 v3 缓存时可导入的数据
 */
export interface CacheMigrationSource {
    chapters: ReadonlyArray<readonly [number, Chapter]>;
    meta?: CacheMeta;
}

export interface CacheClaimV3Result {
    compatibility: ImageCacheCompatibility;
    invalidatedCount: number;
}

interface StoredChapterV3 {
    version: 3;
    bookId: string;
    index: number;
    chapter: Chapter;
}

interface StoredCoverV3 extends BookCover {
    version: 3;
    bookId: string;
    coverUrl: string;
    updatedAt: number;
}

type CacheTransactionResult<T> = (value: T) => void;

const CACHE_V3_DATABASE = "esj-novel-downloader-cache-v3";
const CACHE_V3_STORE = "records";
const cacheV3Store = createStore(CACHE_V3_DATABASE, CACHE_V3_STORE);

function getManifestKey(bookId: string): IDBValidKey {
    return ["manifest", bookId];
}

function getChapterKey(bookId: string, index: number): IDBValidKey {
    return ["chapter", bookId, index];
}

function getCoverKey(bookId: string, coverUrl: string): IDBValidKey {
    return ["cover", bookId, coverUrl];
}

function getManifestRange(): IDBKeyRange {
    return IDBKeyRange.bound(["manifest", ""], ["manifest", "\uffff"]);
}

function getChapterRange(bookId: string): IDBKeyRange {
    return IDBKeyRange.bound(["chapter", bookId, 0], ["chapter", bookId, Number.MAX_SAFE_INTEGER]);
}

function getCoverRange(bookId: string): IDBKeyRange {
    return IDBKeyRange.bound(["cover", bookId, ""], ["cover", bookId, "\uffff"]);
}

function isBlobLike(value: unknown): value is Blob {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Partial<Blob>;
    return (
        typeof candidate.size === "number" &&
        typeof candidate.type === "string" &&
        typeof candidate.slice === "function" &&
        typeof candidate.arrayBuffer === "function"
    );
}

function isStoredCoverV3(record: unknown, bookId: string, coverUrl: string): record is StoredCoverV3 {
    if (!record || typeof record !== "object") {
        return false;
    }
    const candidate = record as Partial<StoredCoverV3>;
    const formatMatches =
        (candidate.ext === "jpg" && candidate.mediaType === "image/jpeg") ||
        (candidate.ext === "png" && candidate.mediaType === "image/png");
    return Boolean(
        candidate.version === 3 &&
        candidate.bookId === bookId &&
        candidate.coverUrl === coverUrl &&
        isBlobLike(candidate.blob) &&
        candidate.blob.type === candidate.mediaType &&
        formatMatches
    );
}

function normalizeMeta(bookId: string, meta?: CacheMeta): CacheMeta | undefined {
    if (!meta) {
        return undefined;
    }
    return { ...meta, bookId, updatedAt: Date.now() };
}

function createCacheAbortError(): DOMException {
    return new DOMException("缓存事务已中止", "AbortError");
}

function runWriteTransaction<T>(
    operation: (store: IDBObjectStore, setResult: CacheTransactionResult<T>) => void,
    signal?: AbortSignal
): Promise<T> {
    return cacheV3Store(
        "readwrite",
        (store) =>
            new Promise<T>((resolve, reject) => {
                let result: T;
                let hasResult = false;
                const transaction = store.transaction;
                const cleanupAbortListener = () => signal?.removeEventListener("abort", onSignalAbort);
                const onSignalAbort = () => {
                    try {
                        transaction.abort();
                    } catch {
                        // 事务已经完成时无需重复中止
                    }
                    cleanupAbortListener();
                    reject(createCacheAbortError());
                };

                transaction.oncomplete = () => {
                    cleanupAbortListener();
                    if (!hasResult) {
                        reject(new Error("缓存事务未返回结果"));
                        return;
                    }
                    resolve(result);
                };
                transaction.onabort = () => {
                    cleanupAbortListener();
                    reject(
                        signal?.aborted ? createCacheAbortError() : transaction.error || new Error("缓存事务已中止")
                    );
                };
                transaction.onerror = () => {
                    cleanupAbortListener();
                    reject(signal?.aborted ? createCacheAbortError() : transaction.error || new Error("缓存事务失败"));
                };

                if (signal?.aborted) {
                    onSignalAbort();
                    return;
                }
                signal?.addEventListener("abort", onSignalAbort, { once: true });

                try {
                    operation(store, (value) => {
                        result = value;
                        hasResult = true;
                    });
                } catch (error) {
                    try {
                        transaction.abort();
                    } catch {
                        // 同步异常发生在事务完成边界时无需重复中止
                    }
                    cleanupAbortListener();
                    reject(error);
                }
            })
    );
}

/**
 * 读取指定书籍的 v3 缓存清单
 */
export async function readCacheManifestV3(bookId: string): Promise<CacheManifestV3 | undefined> {
    return get<CacheManifestV3>(getManifestKey(bookId), cacheV3Store);
}

/**
 * 读取指定书籍的全部 v3 章节
 */
export async function readCacheChaptersV3(bookId: string): Promise<Map<number, Chapter>> {
    const records = await cacheV3Store("readonly", (store) => promisifyRequest(store.getAll(getChapterRange(bookId))));
    return new Map(
        (records as StoredChapterV3[])
            .filter((record) => record.version === 3 && record.bookId === bookId)
            .map((record) => [record.index, record.chapter])
    );
}

/**
 * 按书籍和封面 URL 读取独立封面记录
 */
export async function readCacheCoverV3(bookId: string, coverUrl: string): Promise<BookCover | null> {
    const record = await get<StoredCoverV3>(getCoverKey(bookId, coverUrl), cacheV3Store);
    if (!isStoredCoverV3(record, bookId, coverUrl)) {
        return null;
    }
    return { blob: record.blob, ext: record.ext, mediaType: record.mediaType };
}

/**
 * 列出全部 v3 缓存清单
 */
export async function listCacheManifestsV3(): Promise<CacheManifestV3[]> {
    const records = await cacheV3Store("readonly", (store) => promisifyRequest(store.getAll(getManifestRange())));
    return (records as CacheManifestV3[]).filter((record) => record.version === 3);
}

/**
 * 原子认领 v3 缓存写入权，并按需导入旧缓存
 */
export async function claimCacheV3(
    bookId: string,
    taskId: string,
    migrationSource: CacheMigrationSource | null,
    maxAgeMs: number,
    requestedImageEnabled: boolean,
    signal?: AbortSignal
): Promise<CacheClaimV3Result> {
    return runWriteTransaction<CacheClaimV3Result>((store, setResult) => {
        const request = store.get(getManifestKey(bookId));
        request.onsuccess = () => {
            const current = request.result as CacheManifestV3 | undefined;
            const reusable = Boolean(
                current && !current.cleared && current.version === 3 && Date.now() - current.ts <= maxAgeMs
            );
            if (current && reusable) {
                const compatibility = evaluateImageCacheCompatibility(
                    current.meta?.imageEnabled,
                    requestedImageEnabled
                );
                if (compatibility !== "compatible") {
                    store.delete(getChapterRange(bookId));
                }
                const claimedManifest: CacheManifestV3 = {
                    ...current,
                    ts: Date.now(),
                    chapterCount: compatibility === "compatible" ? current.chapterCount : 0,
                    ...(current.meta
                        ? { meta: { ...current.meta, imageEnabled: requestedImageEnabled, updatedAt: Date.now() } }
                        : {}),
                    writerTaskId: taskId,
                    cleared: false
                };
                delete claimedManifest.writerClosedAt;
                store.put(claimedManifest, getManifestKey(bookId));
                setResult({
                    compatibility,
                    invalidatedCount: compatibility === "compatible" ? 0 : current.chapterCount
                });
                return;
            }

            store.delete(getChapterRange(bookId));
            const migrationCompatibility = migrationSource
                ? evaluateImageCacheCompatibility(migrationSource.meta?.imageEnabled, requestedImageEnabled)
                : "compatible";
            const migratedEntries =
                !current && migrationSource && migrationCompatibility === "compatible" ? migrationSource.chapters : [];
            for (const [index, chapter] of migratedEntries) {
                store.put(
                    { version: 3, bookId, index, chapter } satisfies StoredChapterV3,
                    getChapterKey(bookId, index)
                );
            }
            store.put(
                {
                    version: 3,
                    bookId,
                    ts: Date.now(),
                    chapterCount: migratedEntries.length,
                    ...(migratedEntries.length > 0 && migrationSource?.meta ? { meta: migrationSource.meta } : {}),
                    writerTaskId: taskId,
                    cleared: false
                } satisfies CacheManifestV3,
                getManifestKey(bookId)
            );
            setResult({
                compatibility: migrationCompatibility,
                invalidatedCount:
                    migrationSource && migrationCompatibility !== "compatible" ? migrationSource.chapters.length : 0
            });
        };
    }, signal);
}

/**
 * 在同一事务中校验 writer、写入章节并更新清单
 */
export async function putCacheBatchV3(
    bookId: string,
    taskId: string,
    entries: ReadonlyMap<number, Chapter>,
    meta?: CacheMeta,
    signal?: AbortSignal
): Promise<boolean> {
    return runWriteTransaction<boolean>((store, setResult) => {
        const request = store.get(getManifestKey(bookId));
        request.onsuccess = () => {
            const current = request.result as CacheManifestV3 | undefined;
            if (
                !current ||
                current.writerTaskId !== taskId ||
                current.cleared ||
                current.writerClosedAt !== undefined
            ) {
                setResult(false);
                return;
            }

            for (const [index, chapter] of entries) {
                store.put(
                    { version: 3, bookId, index, chapter } satisfies StoredChapterV3,
                    getChapterKey(bookId, index)
                );
            }

            const countRequest = store.count(getChapterRange(bookId));
            countRequest.onsuccess = () => {
                const normalizedMeta = normalizeMeta(bookId, meta) || current.meta;
                store.put(
                    {
                        ...current,
                        ts: normalizedMeta?.updatedAt || Date.now(),
                        chapterCount: countRequest.result,
                        ...(normalizedMeta === undefined ? {} : { meta: normalizedMeta })
                    } satisfies CacheManifestV3,
                    getManifestKey(bookId)
                );
                setResult(true);
            };
        };
    }, signal);
}

/**
 * 当前 writer 原子替换指定书籍的封面记录；URL 变化时不会残留旧 Blob
 */
export async function putCacheCoverV3ForTask(
    bookId: string,
    taskId: string,
    coverUrl: string,
    cover: BookCover,
    signal?: AbortSignal
): Promise<boolean> {
    return runWriteTransaction<boolean>((store, setResult) => {
        const request = store.get(getManifestKey(bookId));
        request.onsuccess = () => {
            const current = request.result as CacheManifestV3 | undefined;
            if (
                !current ||
                current.writerTaskId !== taskId ||
                current.cleared ||
                current.writerClosedAt !== undefined
            ) {
                setResult(false);
                return;
            }
            store.delete(getCoverRange(bookId));
            store.put(
                {
                    version: 3,
                    bookId,
                    coverUrl,
                    blob: cover.blob,
                    ext: cover.ext,
                    mediaType: cover.mediaType,
                    updatedAt: Date.now()
                } satisfies StoredCoverV3,
                getCoverKey(bookId, coverUrl)
            );
            setResult(true);
        };
    }, signal);
}

/**
 * 原子提交最终元数据并关闭当前 writer，保留章节和封面供后续任务复用
 */
export async function finishCacheV3ForTask(
    bookId: string,
    taskId: string,
    meta: CacheMeta,
    signal?: AbortSignal
): Promise<boolean> {
    return runWriteTransaction<boolean>((store, setResult) => {
        const request = store.get(getManifestKey(bookId));
        request.onsuccess = () => {
            const current = request.result as CacheManifestV3 | undefined;
            if (!current || current.writerTaskId !== taskId || current.cleared) {
                setResult(false);
                return;
            }
            if (current.writerClosedAt !== undefined) {
                setResult(true);
                return;
            }

            const countRequest = store.count(getChapterRange(bookId));
            countRequest.onsuccess = () => {
                const normalizedMeta = normalizeMeta(bookId, meta);
                const writerClosedAt = Date.now();
                store.put(
                    {
                        ...current,
                        ts: normalizedMeta?.updatedAt || writerClosedAt,
                        chapterCount: countRequest.result,
                        ...(normalizedMeta === undefined ? {} : { meta: normalizedMeta }),
                        writerClosedAt
                    } satisfies CacheManifestV3,
                    getManifestKey(bookId)
                );
                setResult(true);
            };
        };
    }, signal);
}

/**
 * 仅允许当前 writer 清理章节并写入 v3 墓碑
 */
export async function clearCacheV3ForTask(bookId: string, taskId: string, signal?: AbortSignal): Promise<boolean> {
    return runWriteTransaction<boolean>((store, setResult) => {
        const request = store.get(getManifestKey(bookId));
        request.onsuccess = () => {
            const current = request.result as CacheManifestV3 | undefined;
            if (!current || current.writerTaskId !== taskId) {
                setResult(false);
                return;
            }
            store.delete(getChapterRange(bookId));
            store.delete(getCoverRange(bookId));
            store.put(
                {
                    version: 3,
                    bookId,
                    ts: Date.now(),
                    chapterCount: 0,
                    writerTaskId: taskId,
                    cleared: true
                } satisfies CacheManifestV3,
                getManifestKey(bookId)
            );
            setResult(true);
        };
    }, signal);
}

/**
 * 清理未受活动 writer 保护的章节并写入 v3 墓碑
 */
export async function clearCacheV3(bookId: string, isWriterActive: (taskId: string) => boolean): Promise<boolean> {
    return runWriteTransaction<boolean>((store, setResult) => {
        const request = store.get(getManifestKey(bookId));
        request.onsuccess = () => {
            const current = request.result as CacheManifestV3 | undefined;
            if (current?.writerTaskId && isWriterActive(current.writerTaskId)) {
                setResult(false);
                return;
            }
            store.delete(getChapterRange(bookId));
            store.delete(getCoverRange(bookId));
            store.put(
                {
                    version: 3,
                    bookId,
                    ts: Date.now(),
                    chapterCount: 0,
                    writerTaskId: current?.writerTaskId || "cleared",
                    cleared: true
                } satisfies CacheManifestV3,
                getManifestKey(bookId)
            );
            setResult(true);
        };
    });
}
