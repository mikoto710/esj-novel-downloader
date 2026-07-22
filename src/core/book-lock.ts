import { createStore, entries, get, update } from "idb-keyval";
import { BookDownloadLock, SourcePageType } from "../types";

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
        // localStorage 不可用时继续依靠心跳 TTL。
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
        // localStorage 不可用时继续依靠心跳 TTL。
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

export function hasBookDownloadTaskPresence(taskId: string): boolean {
    try {
        return localStorage.getItem(createPresenceKey(taskId)) === taskId;
    } catch {
        return true;
    }
}

export type FullBookSourcePageType = Extract<SourcePageType, "detail" | "forum">;
export type AcquireBookLockResult =
    | { acquired: true; lock: BookDownloadLock }
    | { acquired: false; lock: BookDownloadLock };
export type RequestBookDownloadCancellationResult = { requested: true; taskId: string } | { requested: false };
export type WaitForBookDownloadCancellationResult =
    | { status: "released"; cacheCleared: boolean }
    | { status: "replaced" | "stale" | "timeout" };

export async function getActiveBookDownloadLock(bookId: string): Promise<BookDownloadLock | null> {
    const lock = await get<BookDownloadLock>(bookId, lockStore);
    return isLockActive(lock) ? lock : null;
}

export async function getConflictingBookDownloadLock(bookId: string): Promise<BookDownloadLock | null> {
    return getActiveBookDownloadLock(bookId);
}

export async function ownsActiveBookDownloadLock(lock: BookDownloadLock | null): Promise<boolean> {
    if (!lock) {
        return false;
    }
    const current = await get<BookDownloadLock>(lock.bookId, lockStore);
    return Boolean(current && current.taskId === lock.taskId && isLockActive(current));
}

export async function listActiveBookDownloadLocks(): Promise<BookDownloadLock[]> {
    const allEntries = await entries<string, BookDownloadLock>(lockStore);
    return allEntries.map(([, lock]) => lock).filter((lock): lock is BookDownloadLock => isLockActive(lock));
}

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

export async function shouldDiscardBookDownloadCache(lock: BookDownloadLock | null): Promise<boolean> {
    if (!lock) {
        return false;
    }

    const current = await get<BookDownloadLock>(lock.bookId, lockStore);
    return Boolean(
        current && current.taskId === lock.taskId && current.cancelRequestedAt && current.discardCacheOnCancel
    );
}

async function isBookDownloadCancellationRequested(lock: BookDownloadLock): Promise<boolean> {
    const current = await get<BookDownloadLock>(lock.bookId, lockStore);
    return Boolean(current && current.taskId === lock.taskId && current.cancelRequestedAt);
}

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

export function startBookDownloadLockHeartbeat(
    lock: BookDownloadLock,
    onCancellationRequested?: () => void
): () => void {
    let stopped = false;
    let refreshing = false;
    const releaseOnPageHide = () => {
        onCancellationRequested?.();
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
                if (!owned || (await isBookDownloadCancellationRequested(lock))) {
                    onCancellationRequested?.();
                }
            })
            .catch((error) => {
                console.error("刷新下载任务锁失败", error);
            })
            .finally(() => {
                refreshing = false;
            });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
        stopped = true;
        window.clearInterval(timer);
        window.removeEventListener("pagehide", releaseOnPageHide);
    };
}

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
