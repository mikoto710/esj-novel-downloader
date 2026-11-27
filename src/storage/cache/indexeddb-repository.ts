import { get, promisifyRequest } from "idb-keyval";
import { cacheV3Store, runWriteTransaction } from "./database";
import type { ChapterCacheSources } from "./chapter-source";
import { createStorageError } from "./storage-error";
import type { CacheMeta } from "./model";
import type { BookCover, Chapter } from "../../content/model";
import { evaluateImageCacheCompatibility, type ImageCacheCompatibility } from "./compatibility";

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

export type CacheClaimV3Result =
    | { status: "ownership-lost" }
    | { status: "claimed"; compatibility: ImageCacheCompatibility; invalidatedCount: number }
    | {
          status: "needs-confirmation";
          compatibility: ImageCacheCompatibility;
          indexes: number[];
          meta?: CacheMeta;
      };

interface StoredChapterV3 {
    version: 3;
    bookId: string;
    index: number;
    chapter: Chapter;
}

interface StoredChapterSourceV3 {
    index: number;
    source: string;
}

interface StoredCoverV3 extends BookCover {
    version: 3;
    bookId: string;
    coverUrl: string;
    updatedAt: number;
}

function getManifestKey(bookId: string): IDBValidKey {
    return ["manifest", bookId];
}

function getChapterKey(bookId: string, index: number): IDBValidKey {
    return ["chapter", bookId, index];
}

function getChapterSourceKey(bookId: string, index: number): IDBValidKey {
    return ["chapter-source", bookId, index];
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

function getChapterSourceRange(bookId: string): IDBKeyRange {
    return IDBKeyRange.bound(getChapterSourceKey(bookId, 0), getChapterSourceKey(bookId, Number.MAX_SAFE_INTEGER));
}

function deleteBookChapters(store: IDBObjectStore, bookId: string): void {
    store.delete(getChapterRange(bookId));
    store.delete(getChapterSourceRange(bookId));
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

/**
 * 读取指定书籍的 v3 缓存清单
 */
export async function readCacheManifestV3(bookId: string): Promise<CacheManifestV3 | undefined> {
    return get<CacheManifestV3>(getManifestKey(bookId), cacheV3Store);
}

function getChapterIndexes(keys: IDBValidKey[]): number[] {
    return keys.flatMap((key) => {
        const index = Array.isArray(key) ? key[2] : undefined;
        return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? [index] : [];
    });
}

function readChapterSources(
    store: IDBObjectStore,
    bookId: string,
    requested: ChapterCacheSources | undefined
): Promise<Map<number, string> | undefined> {
    if (!requested) {
        return Promise.resolve(undefined);
    }
    return promisifyRequest<StoredChapterSourceV3[]>(store.getAll(getChapterSourceRange(bookId))).then(
        (records) => new Map(records.map(({ index, source }) => [index, source]))
    );
}

function matchesChapterSource(
    index: number,
    current: ChapterCacheSources | undefined,
    stored: ReadonlyMap<number, string> | undefined
): boolean {
    const source = current?.get(index);
    return source !== undefined && source === stored?.get(index);
}

/**
 * 在同一只读快照中读取清单、章节索引和来源，不加载正文或 Blob
 */
export async function previewCacheV3(
    bookId: string,
    requested?: ChapterCacheSources
): Promise<{ manifest: CacheManifestV3 | undefined; indexes: number[]; size: number }> {
    return cacheV3Store("readonly", async (store) => {
        const [manifest, keys, sources] = await Promise.all([
            promisifyRequest<CacheManifestV3 | undefined>(store.get(getManifestKey(bookId))),
            promisifyRequest<IDBValidKey[]>(store.getAllKeys(getChapterRange(bookId))),
            readChapterSources(store, bookId, requested)
        ]);
        const indexes = getChapterIndexes(keys);
        return {
            manifest,
            size: indexes.length,
            indexes: requested ? indexes.filter((index) => matchesChapterSource(index, requested, sources)) : indexes
        };
    });
}

/**
 * 读取 v3 章节，按当前快照复核任务所有权及被选章节的来源
 */
export async function readCacheChaptersV3(
    bookId: string,
    requested?: ChapterCacheSources,
    taskId?: string
): Promise<Map<number, Chapter>> {
    return cacheV3Store("readonly", async (store) => {
        const [records, sources, manifest] = await Promise.all([
            promisifyRequest<StoredChapterV3[]>(store.getAll(getChapterRange(bookId))),
            readChapterSources(store, bookId, requested),
            taskId ? promisifyRequest<CacheManifestV3 | undefined>(store.get(getManifestKey(bookId))) : undefined
        ]);
        if (taskId && !isOpenWriter(manifest, taskId)) {
            throw createStorageError("ownership-lost", "claim");
        }
        return new Map(
            records
                .filter(
                    ({ version, bookId: recordBookId, index }) =>
                        version === 3 &&
                        recordBookId === bookId &&
                        (!requested?.has(index) || matchesChapterSource(index, requested, sources))
                )
                .map(({ index, chapter }) => [index, chapter])
        );
    });
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

// 同一事务内读取缓存清单并以当前 writer 判定后续写入
function writeBookCache<T>(
    bookId: string,
    write: (store: IDBObjectStore, current: CacheManifestV3 | undefined, setResult: (result: T) => void) => void,
    signal?: AbortSignal
): Promise<T> {
    return runWriteTransaction<T>((store, setResult) => {
        const manifestRequest: IDBRequest<CacheManifestV3 | undefined> = store.get(getManifestKey(bookId));
        manifestRequest.onsuccess = () => write(store, manifestRequest.result, setResult);
    }, signal);
}

/**
 * 原子认领 v3 缓存写入权，并按需导入旧缓存
 */
export async function claimCacheV3(
    bookId: string,
    taskId: string,
    expectedWriterTaskId: string | undefined,
    migrationSource: CacheMigrationSource | null,
    maxAgeMs: number,
    requestedImageEnabled: boolean,
    signal?: AbortSignal,
    allowInvalidation = false
): Promise<CacheClaimV3Result> {
    return writeBookCache<CacheClaimV3Result>(
        bookId,
        (store, current, setResult) => {
            if (current?.writerTaskId !== expectedWriterTaskId) {
                setResult({ status: "ownership-lost" });
                return;
            }
            const reusable = Boolean(
                current && !current.cleared && current.version === 3 && Date.now() - current.ts <= maxAgeMs
            );
            if (current && reusable) {
                const compatibility = evaluateImageCacheCompatibility(
                    current.meta?.imageEnabled,
                    requestedImageEnabled
                );
                const claimCurrent = () => {
                    if (compatibility !== "compatible") {
                        deleteBookChapters(store, bookId);
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
                        status: "claimed",
                        compatibility,
                        invalidatedCount: compatibility === "compatible" ? 0 : current.chapterCount
                    });
                };
                if (compatibility !== "compatible" && !allowInvalidation) {
                    // 确认与认领共用写事务，拒绝时不改变 writer 或章节
                    const keysRequest = store.getAllKeys(getChapterRange(bookId));
                    keysRequest.onsuccess = () => {
                        const indexes = getChapterIndexes(keysRequest.result);
                        if (indexes.length === 0) {
                            claimCurrent();
                            return;
                        }
                        setResult({
                            status: "needs-confirmation",
                            compatibility,
                            indexes,
                            ...(current.meta === undefined ? {} : { meta: current.meta })
                        });
                    };
                } else {
                    claimCurrent();
                }
                return;
            }

            // 已有 v3 清单（含 cleared 标记）时，不导入旧缓存
            const source = current ? null : migrationSource;
            const migrationCompatibility = source
                ? evaluateImageCacheCompatibility(source.meta?.imageEnabled, requestedImageEnabled)
                : "compatible";
            if (source && source.chapters.length > 0 && migrationCompatibility !== "compatible" && !allowInvalidation) {
                setResult({
                    status: "needs-confirmation",
                    compatibility: migrationCompatibility,
                    indexes: Array.from(new Set(source.chapters.map(([index]) => index))),
                    ...(source.meta === undefined ? {} : { meta: source.meta })
                });
                return;
            }
            deleteBookChapters(store, bookId);
            const migratedEntries = source && migrationCompatibility === "compatible" ? source.chapters : [];
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
                status: "claimed",
                compatibility: migrationCompatibility,
                invalidatedCount: source && migrationCompatibility !== "compatible" ? source.chapters.length : 0
            });
        },
        signal
    );
}

function isOpenWriter(manifest: CacheManifestV3 | undefined, taskId: string): manifest is CacheManifestV3 {
    return !!manifest && manifest.writerTaskId === taskId && !manifest.cleared && manifest.writerClosedAt === undefined;
}

/**
 * 在同一事务中校验 writer、写入章节并更新清单
 */
export async function putCacheBatchV3(
    bookId: string,
    taskId: string,
    entries: ReadonlyMap<number, Chapter>,
    meta?: CacheMeta,
    signal?: AbortSignal,
    sources?: ChapterCacheSources
): Promise<boolean> {
    return writeBookCache(
        bookId,
        (store, current, setResult) => {
            if (!isOpenWriter(current, taskId)) {
                setResult(false);
                return;
            }

            for (const [index, chapter] of entries) {
                const source = sources?.get(index);
                const sourceKey = getChapterSourceKey(bookId, index);
                if (source === undefined) {
                    store.delete(sourceKey);
                } else {
                    store.put({ index, source } satisfies StoredChapterSourceV3, sourceKey);
                }
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
        },
        signal
    );
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
    return writeBookCache(
        bookId,
        (store, current, setResult) => {
            if (!isOpenWriter(current, taskId)) {
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
        },
        signal
    );
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
    return writeBookCache(
        bookId,
        (store, current, setResult) => {
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
        },
        signal
    );
}

function writeClearedCache(store: IDBObjectStore, bookId: string, writerTaskId: string): void {
    deleteBookChapters(store, bookId);
    store.delete(getCoverRange(bookId));
    store.put(
        {
            version: 3,
            bookId,
            ts: Date.now(),
            chapterCount: 0,
            writerTaskId,
            cleared: true
        } satisfies CacheManifestV3,
        getManifestKey(bookId)
    );
}

/**
 * 仅允许当前 writer 清理章节和封面，并写入 cleared 清单
 */
export async function clearCacheV3ForTask(bookId: string, taskId: string, signal?: AbortSignal): Promise<boolean> {
    return writeBookCache(
        bookId,
        (store, current, setResult) => {
            if (!current || current.writerTaskId !== taskId) {
                setResult(false);
                return;
            }
            writeClearedCache(store, bookId, taskId);
            setResult(true);
        },
        signal
    );
}

/**
 * writer 未变化时清理章节和封面，并写入 cleared 清单
 */
export async function clearCacheV3(bookId: string, expectedWriterTaskId: string | undefined): Promise<boolean> {
    return writeBookCache(bookId, (store, current, setResult) => {
        if (current?.writerTaskId !== expectedWriterTaskId) {
            setResult(false);
            return;
        }
        writeClearedCache(store, bookId, current?.writerTaskId || "cleared");
        setResult(true);
    });
}
