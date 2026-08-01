import { createStore, entries, get, update } from "idb-keyval";
import { BookDownloadLock, DownloadCancellationMode, SourcePageType } from "../types";

const LOCK_TTL_MS = 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 3 * 1000;
const CANCELLATION_GRACE_MS = 10 * 1000;
const PRESENCE_KEY_PREFIX = "esj_download_lock_presence_";
const lockStore = createStore("esj-novel-downloader", "book-download-locks");

function createPresenceKey(taskId: string): string {
    return `${PRESENCE_KEY_PREFIX}${taskId}`;
}

function registerLockPresence(lock: BookDownloadLock): void {
    if (!lock.presenceKey) {
        return;
    }
    try {
        localStorage.setItem(lock.presenceKey, lock.taskId);
    } catch {
        // localStorage 不可用时继续依靠心跳 TTL
    }
}

function clearLockPresence(lock: BookDownloadLock): void {
    if (!lock.presenceKey) {
        return;
    }
    try {
        if (localStorage.getItem(lock.presenceKey) === lock.taskId) {
            localStorage.removeItem(lock.presenceKey);
        }
    } catch {
        // localStorage 不可用时继续依靠心跳 TTL
    }
}

function hasLockPresence(lock: BookDownloadLock): boolean {
    if (!lock.presenceKey) {
        return true;
    }
    try {
        return localStorage.getItem(lock.presenceKey) === lock.taskId;
    } catch {
        return true;
    }
}

/**
 * 判断指定任务是否仍有页面 presence 标记
 */
export function hasBookDownloadTaskPresence(taskId: string): boolean {
    try {
        return localStorage.getItem(createPresenceKey(taskId)) === taskId;
    } catch {
        return true;
    }
}

/**
 * 支持启动全本下载的页面类型
 */
export type FullBookSourcePageType = Extract<SourcePageType, "detail" | "forum">;

/**
 * 获取任务锁的结果
 */
export type AcquireBookLockResult =
    | { acquired: true; lock: BookDownloadLock }
    | { acquired: false; lock: BookDownloadLock };
/**
 * 请求取消任务的结果
 */
export type RequestBookDownloadCancellationResult = { requested: true; taskId: string } | { requested: false };

/**
 * 等待远程取消完成的结果
 */
export type WaitForBookDownloadCancellationResult =
    | { status: "released"; cacheCleared: boolean }
    | { status: "replaced" | "stale" | "timeout" };

/**
 * 获取指定书籍仍有效的下载任务锁
 */
export async function getActiveBookDownloadLock(bookId: string): Promise<BookDownloadLock | null> {
    const lock = await get<BookDownloadLock>(bookId, lockStore);
    return isLockActive(lock) ? lock : null;
}

/**
 * 获取会阻止当前页面启动下载的冲突任务锁
 */
export async function getConflictingBookDownloadLock(bookId: string): Promise<BookDownloadLock | null> {
    return getActiveBookDownloadLock(bookId);
}

/**
 * 判断任务是否仍拥有对应书籍的有效锁
 */
export async function ownsActiveBookDownloadLock(lock: BookDownloadLock | null): Promise<boolean> {
    if (!lock) {
        return false;
    }
    const current = await get<BookDownloadLock>(lock.bookId, lockStore);
    return Boolean(current && current.taskId === lock.taskId && isLockActive(current));
}

/**
 * 列出全部仍有效的全本下载任务锁
 */
export async function listActiveBookDownloadLocks(): Promise<BookDownloadLock[]> {
    const allEntries = await entries<string, BookDownloadLock>(lockStore);
    return allEntries.map(([, lock]) => lock).filter((lock): lock is BookDownloadLock => isLockActive(lock));
}

/**
 * 向指定书籍的活动任务写入取消请求
 */
export async function requestBookDownloadCancellation(
    bookId: string,
    discardCache: boolean
): Promise<RequestBookDownloadCancellationResult> {
    let result: RequestBookDownloadCancellationResult = { requested: false };

    await update<BookDownloadLock>(
        bookId,
        (current) => {
            if (!isLockActive(current)) {
                return (
                    current || {
                        bookId,
                        taskId: "released",
                        sourcePageType: "detail",
                        status: "released",
                        startedAt: Date.now(),
                        heartbeatAt: Date.now(),
                        releasedAt: Date.now()
                    }
                );
            }

            result = { requested: true, taskId: current.taskId };
            return {
                ...current,
                cancelRequestedAt: Date.now(),
                discardCacheOnCancel: discardCache
            };
        },
        lockStore
    );

    return result;
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
        const current = await get<BookDownloadLock>(bookId, lockStore);
        if (!current) {
            return { status: "stale" };
        }
        if (current.taskId !== taskId) {
            return { status: "replaced" };
        }
        if (current.status === "released") {
            return { status: "released", cacheCleared: Boolean(current.discardCacheCompletedAt) };
        }
        if (!isLockActive(current)) {
            return { status: "stale" };
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }
    return { status: "timeout" };
}

/**
 * 判断当前任务是否收到取消并清理缓存的请求
 */
export async function shouldDiscardBookDownloadCache(lock: BookDownloadLock | null): Promise<boolean> {
    if (!lock) {
        return false;
    }

    const current = await get<BookDownloadLock>(lock.bookId, lockStore);
    return Boolean(
        current && current.taskId === lock.taskId && current.cancelRequestedAt && current.discardCacheOnCancel
    );
}

async function getBookDownloadCancellationMode(lock: BookDownloadLock): Promise<DownloadCancellationMode | null> {
    const current = await get<BookDownloadLock>(lock.bookId, lockStore);
    if (!current || current.taskId !== lock.taskId || !current.cancelRequestedAt) {
        return null;
    }
    return current.discardCacheOnCancel ? "discard" : "flush";
}

/**
 * 更新当前任务锁中的书名和心跳时间
 */
export async function updateBookDownloadLockTitle(lock: BookDownloadLock, bookName: string): Promise<void> {
    await update<BookDownloadLock>(
        lock.bookId,
        (current) => {
            if (!current || current.taskId !== lock.taskId || !isLockActive(current)) {
                return current || createReleasedLock(lock);
            }
            return { ...current, bookName, heartbeatAt: Date.now() };
        },
        lockStore
    );
}

function isLockActive(lock: BookDownloadLock | undefined, now = Date.now()): lock is BookDownloadLock {
    return Boolean(lock && lock.status !== "released" && hasLockPresence(lock) && now - lock.heartbeatAt < LOCK_TTL_MS);
}

function createTaskId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createReleasedLock(lock: BookDownloadLock): BookDownloadLock {
    const releasedAt = Date.now();
    return { ...lock, status: "released", releasedAt, heartbeatAt: releasedAt };
}

/**
 * 原子获取指定书籍的全本下载任务锁
 * 已存在有效任务时返回冲突锁，不覆盖现有所有者
 */
export async function acquireBookDownloadLock(
    bookId: string,
    sourcePageType: FullBookSourcePageType
): Promise<AcquireBookLockResult> {
    const now = Date.now();
    const candidate: BookDownloadLock = {
        bookId,
        taskId: createTaskId(),
        sourcePageType,
        status: "preparing",
        startedAt: now,
        heartbeatAt: now
    };
    candidate.presenceKey = createPresenceKey(candidate.taskId);
    registerLockPresence(candidate);
    let result: AcquireBookLockResult | null = null;
    let replacedLock: BookDownloadLock | null = null;

    try {
        await update<BookDownloadLock>(
            bookId,
            (current) => {
                if (isLockActive(current, now)) {
                    result = { acquired: false, lock: current };
                    return current;
                }
                replacedLock = current || null;
                result = { acquired: true, lock: candidate };
                return candidate;
            },
            lockStore
        );
    } catch (error) {
        clearLockPresence(candidate);
        throw error;
    }

    const finalResult = result as AcquireBookLockResult | null;
    const previousLock = replacedLock as BookDownloadLock | null;
    if (!finalResult) {
        clearLockPresence(candidate);
        throw new Error("无法创建下载任务锁");
    }
    if (!finalResult.acquired) {
        clearLockPresence(candidate);
    } else if (previousLock) {
        clearLockPresence(previousLock);
    }
    return finalResult;
}

/**
 * 将已取得的任务锁标记为运行中
 */
export async function markBookDownloadRunning(lock: BookDownloadLock): Promise<boolean> {
    let updated = false;
    await update<BookDownloadLock>(
        lock.bookId,
        (current) => {
            if (
                !current ||
                current.taskId !== lock.taskId ||
                !isLockActive(current) ||
                Boolean(current.cancelRequestedAt)
            ) {
                return current || createReleasedLock(lock);
            }
            updated = true;
            return { ...current, status: "running", heartbeatAt: Date.now() };
        },
        lockStore
    );
    return updated;
}

/**
 * 刷新当前任务锁的心跳时间
 */
export async function heartbeatBookDownloadLock(lock: BookDownloadLock): Promise<boolean> {
    let updated = false;
    await update<BookDownloadLock>(
        lock.bookId,
        (current) => {
            if (!current || current.taskId !== lock.taskId || !isLockActive(current)) {
                return current || createReleasedLock(lock);
            }
            updated = true;
            return { ...current, heartbeatAt: Date.now() };
        },
        lockStore
    );
    return updated;
}

/**
 * 启动任务锁心跳和页面关闭监听
 * 返回函数用于停止定时器和移除监听器
 */
export function startBookDownloadLockHeartbeat(
    lock: BookDownloadLock,
    onCancellationRequested?: (mode: DownloadCancellationMode) => void,
    intervalMs = HEARTBEAT_INTERVAL_MS
): () => void {
    let stopped = false;
    let refreshing = false;
    const releaseOnPageHide = () => {
        onCancellationRequested?.("flush");
        clearLockPresence(lock);
        void releaseBookDownloadLock(lock).catch((error) => {
            console.error("页面关闭时释放下载任务锁失败", error);
        });
    };
    window.addEventListener("pagehide", releaseOnPageHide, { once: true });
    const timer = window.setInterval(() => {
        if (stopped || refreshing) {
            return;
        }
        refreshing = true;
        void heartbeatBookDownloadLock(lock)
            .then(async (owned) => {
                if (!owned) {
                    onCancellationRequested?.("discard");
                    return;
                }
                const cancellationMode = await getBookDownloadCancellationMode(lock);
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
        stopped = true;
        window.clearInterval(timer);
        window.removeEventListener("pagehide", releaseOnPageHide);
    };
}

/**
 * 释放当前任务锁并保留 released 状态供远程页面观察
 */
export async function releaseBookDownloadLock(
    lock: BookDownloadLock,
    options: { cacheDiscarded?: boolean } = {}
): Promise<void> {
    clearLockPresence(lock);
    await update<BookDownloadLock>(
        lock.bookId,
        (current) => {
            if (!current || current.taskId !== lock.taskId) {
                return current || createReleasedLock(lock);
            }
            const releasedAt = Date.now();
            return {
                ...current,
                status: "released",
                releasedAt,
                heartbeatAt: releasedAt,
                discardCacheCompletedAt: options.cacheDiscarded ? releasedAt : current.discardCacheCompletedAt
            };
        },
        lockStore
    );
}
