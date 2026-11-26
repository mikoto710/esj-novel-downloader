import { get, promisifyRequest } from "idb-keyval";
import type { DownloadCancellationMode } from "../download/contracts";
import type { SourcePageType } from "../content/model";
import { cacheV3Store, getBookLockKey, runWriteTransaction } from "./cache/database";

export type BookDownloadLockStatus = "preparing" | "running" | "released";

/**
 * 跨页面的书籍下载任务锁，全本与自选共用
 */
export interface BookDownloadLock {
    bookId: string;
    bookName?: string;
    taskId: string;
    sourcePageType: FullBookSourcePageType;
    status: BookDownloadLockStatus;
    startedAt: number;
    heartbeatAt: number;
    releasedAt?: number;
    cancelRequestedAt?: number;
    discardCacheOnCancel?: boolean;
    discardCacheCompletedAt?: number;
}

export type FullBookSourcePageType = Extract<SourcePageType, "detail" | "forum">;

export type AcquireBookLockResult =
    | { acquired: true; lock: BookDownloadLock }
    | { acquired: false; lock: BookDownloadLock };

export type RequestBookDownloadCancellationResult =
    | { requested: true; taskId: string }
    | { requested: false; status: "not-active" | "replaced" };

export type ReleaseBookDownloadLockResult = "released" | "discard-requested" | "ownership-lost";

export type WaitForBookDownloadCancellationResult =
    | { status: "released"; cacheCleared: boolean }
    | { status: "replaced" | "stale" | "timeout" };

const LOCK_TTL_MS = 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 3 * 1000;
const CANCELLATION_GRACE_MS = 10 * 1000;

/**
 * 锁和持久缓存写入使用相同的有效期判定
 */
export function isBookDownloadLockActive(lock: BookDownloadLock | undefined): lock is BookDownloadLock {
    return lock !== undefined && lock.status !== "released" && Date.now() - lock.heartbeatAt < LOCK_TTL_MS;
}

function readLock(bookId: string): Promise<BookDownloadLock | undefined> {
    return get<BookDownloadLock>(getBookLockKey(bookId), cacheV3Store);
}

function updateLock<T>(
    bookId: string,
    update: (current: BookDownloadLock | undefined) => { result: T; next?: BookDownloadLock }
): Promise<T> {
    return runWriteTransaction<T>((store, setResult) => {
        const key = getBookLockKey(bookId);
        const request: IDBRequest<BookDownloadLock | undefined> = store.get(key);
        request.onsuccess = () => {
            const { result, next } = update(request.result);
            if (next) {
                store.put(next, key);
            }
            setResult(result);
        };
    });
}

function updateActiveLock(
    lock: BookDownloadLock,
    update: (current: BookDownloadLock) => BookDownloadLock | undefined
): Promise<boolean> {
    return updateLock(lock.bookId, (current) => {
        const next = isBookDownloadLockActive(current) && current.taskId === lock.taskId ? update(current) : undefined;
        return next ? { result: true, next } : { result: false };
    });
}

/**
 * 获取指定书籍仍有效的任务锁
 */
export async function getActiveBookDownloadLock(bookId: string): Promise<BookDownloadLock | null> {
    const lock = await readLock(bookId);
    return isBookDownloadLockActive(lock) ? lock : null;
}

export { getActiveBookDownloadLock as getConflictingBookDownloadLock };

/**
 * 判断任务是否仍拥有对应书籍的有效锁
 */
export async function ownsActiveBookDownloadLock(lock: BookDownloadLock | null): Promise<boolean> {
    return lock !== null && (await getActiveBookDownloadLock(lock.bookId))?.taskId === lock.taskId;
}

/**
 * 列出所有有效的书籍锁
 */
export async function listActiveBookDownloadLocks(): Promise<BookDownloadLock[]> {
    const range = IDBKeyRange.bound(["lock", ""], ["lock", "\uffff"]);
    const locks = await cacheV3Store("readonly", (store) => promisifyRequest<BookDownloadLock[]>(store.getAll(range)));
    return locks.filter(isBookDownloadLockActive);
}

/**
 * 仅向确认时对应的活动任务提交取消请求
 */
export async function requestBookDownloadCancellation(
    bookId: string,
    expectedTaskId: string,
    discardCache: boolean
): Promise<RequestBookDownloadCancellationResult> {
    return updateLock<RequestBookDownloadCancellationResult>(bookId, (current) => {
        if (current && current.taskId !== expectedTaskId) {
            return { result: { requested: false, status: "replaced" } };
        }
        if (!isBookDownloadLockActive(current)) {
            return { result: { requested: false, status: "not-active" } };
        }
        return {
            result: { requested: true, taskId: current.taskId },
            next: {
                ...current,
                cancelRequestedAt: current.cancelRequestedAt ?? Date.now(),
                discardCacheOnCancel: current.discardCacheOnCancel || discardCache
            }
        };
    });
}

/**
 * 等待指定任务释放锁，并区分任务被替换、失效和超时
 */
export async function waitForBookDownloadCancellation(
    bookId: string,
    taskId: string
): Promise<WaitForBookDownloadCancellationResult> {
    const deadline = Date.now() + CANCELLATION_GRACE_MS + 1000;
    while (Date.now() < deadline) {
        const current = await readLock(bookId);
        if (!current) {
            return { status: "stale" };
        }
        if (current.taskId !== taskId) {
            return { status: "replaced" };
        }
        if (current.status === "released") {
            return { status: "released", cacheCleared: current.discardCacheCompletedAt !== undefined };
        }
        if (!isBookDownloadLockActive(current)) {
            return { status: "stale" };
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }
    return { status: "timeout" };
}

async function getBookDownloadCancellationMode(lock: BookDownloadLock): Promise<DownloadCancellationMode | null> {
    const current = await getActiveBookDownloadLock(lock.bookId);
    if (!current || current.taskId !== lock.taskId || current.cancelRequestedAt === undefined) {
        return null;
    }
    return current.discardCacheOnCancel ? "discard" : "flush";
}

/**
 * 判断当前任务是否收到取消并清理缓存的请求
 */
export async function shouldDiscardBookDownloadCache(lock: BookDownloadLock | null): Promise<boolean> {
    return lock !== null && (await getBookDownloadCancellationMode(lock)) === "discard";
}

/**
 * 更新当前任务锁中的书名和心跳时间
 */
export async function updateBookDownloadLockTitle(lock: BookDownloadLock, bookName: string): Promise<void> {
    await updateActiveLock(lock, (current) => ({ ...current, bookName, heartbeatAt: Date.now() }));
}

function createTaskId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 原子获取书籍锁，有效冲突存在时返回其所有者
 */
export async function acquireBookDownloadLock(
    bookId: string,
    sourcePageType: FullBookSourcePageType
): Promise<AcquireBookLockResult> {
    return updateLock<AcquireBookLockResult>(bookId, (current) => {
        if (isBookDownloadLockActive(current)) {
            return { result: { acquired: false, lock: current } };
        }
        const now = Date.now();
        const lock: BookDownloadLock = {
            bookId,
            taskId: createTaskId(),
            sourcePageType,
            status: "preparing",
            startedAt: now,
            heartbeatAt: now
        };
        return { result: { acquired: true, lock }, next: lock };
    });
}

/**
 * 将已取得且未取消的任务锁标记为运行中
 */
export async function markBookDownloadRunning(lock: BookDownloadLock): Promise<boolean> {
    return updateActiveLock(lock, (current) =>
        current.cancelRequestedAt === undefined ? { ...current, status: "running", heartbeatAt: Date.now() } : undefined
    );
}

/**
 * 刷新当前任务锁的心跳时间
 */
export async function heartbeatBookDownloadLock(lock: BookDownloadLock): Promise<boolean> {
    return updateActiveLock(lock, (current) => ({ ...current, heartbeatAt: Date.now() }));
}

/**
 * 启动任务心跳与离页保存监听，锁由任务收尾释放
 */
export function startBookDownloadLockHeartbeat(
    lock: BookDownloadLock,
    onCancellationRequested?: (mode: DownloadCancellationMode) => void,
    intervalMs = HEARTBEAT_INTERVAL_MS
): () => void {
    let refreshing = false;
    const flushOnPageHide = () => onCancellationRequested?.("flush");
    window.addEventListener("pagehide", flushOnPageHide, { once: true });
    const timer = window.setInterval(() => {
        if (refreshing) {
            return;
        }
        refreshing = true;
        void heartbeatBookDownloadLock(lock)
            .then(async (owned) => {
                const cancellationMode = owned ? await getBookDownloadCancellationMode(lock) : "discard";
                if (cancellationMode) {
                    onCancellationRequested?.(cancellationMode);
                }
            })
            .catch((error) => {
                console.error("刷新下载任务锁失败", error);
            })
            .finally(() => {
                refreshing = false;
            });
    }, intervalMs);

    return () => {
        window.clearInterval(timer);
        window.removeEventListener("pagehide", flushOnPageHide);
    };
}

/**
 * 释放当前任务锁或交还尚未处理的清理请求，保留远程等待所需的回执
 */
export async function releaseBookDownloadLock(
    lock: BookDownloadLock,
    options?: { cacheDiscarded: boolean }
): Promise<ReleaseBookDownloadLockResult> {
    return updateLock<ReleaseBookDownloadLockResult>(lock.bookId, (current) => {
        if (!current || current.taskId !== lock.taskId) {
            return { result: "ownership-lost" };
        }
        if (current.status === "released") {
            return { result: "released" };
        }
        if (!isBookDownloadLockActive(current)) {
            return { result: "ownership-lost" };
        }
        if (current.discardCacheOnCancel && options === undefined) {
            return { result: "discard-requested" };
        }
        const releasedAt = Date.now();
        return {
            result: "released",
            next: {
                ...current,
                status: "released",
                releasedAt,
                heartbeatAt: releasedAt,
                ...(options?.cacheDiscarded ? { discardCacheCompletedAt: releasedAt } : {})
            }
        };
    });
}
