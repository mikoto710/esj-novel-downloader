import { createStore, entries, get, update } from "idb-keyval";
import { BookDownloadLock, SourcePageType } from "../types";
import { state } from "./state";

const LOCK_TTL_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 3 * 1000;
const CANCELLATION_GRACE_MS = 10 * 1000;
const lockStore = createStore("esj-novel-downloader", "book-download-locks");

function getPageSessionId(): string {
    const storageKey = "esj_download_lock_session";
    try {
        const existing = sessionStorage.getItem(storageKey);
        if (existing) {
            return existing;
        }
        const created = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        sessionStorage.setItem(storageKey, created);
        return created;
    } catch {
        return "unavailable";
    }
}

const pageSessionId = getPageSessionId();

export type FullBookSourcePageType = Extract<SourcePageType, "detail" | "forum">;
export type AcquireBookLockResult =
    | { acquired: true; lock: BookDownloadLock }
    | { acquired: false; lock: BookDownloadLock };

export async function getActiveBookDownloadLock(bookId: string): Promise<BookDownloadLock | null> {
    const lock = await get<BookDownloadLock>(bookId, lockStore);
    return isLockActive(lock) ? lock : null;
}

export async function listActiveBookDownloadLocks(): Promise<BookDownloadLock[]> {
    const allEntries = await entries<string, BookDownloadLock>(lockStore);
    return allEntries
        .map(([, lock]) => lock)
        .filter((lock): lock is BookDownloadLock => isLockActive(lock));
}

export async function requestBookDownloadCancellation(bookId: string, discardCache: boolean): Promise<boolean> {
    let requested = false;

    await update<BookDownloadLock>(bookId, (current) => {
        if (!isLockActive(current)) {
            return current || {
                bookId,
                taskId: "released",
                sourcePageType: "detail",
                status: "released",
                startedAt: Date.now(),
                heartbeatAt: Date.now(),
                releasedAt: Date.now()
            };
        }

        requested = true;
        return {
            ...current,
            cancelRequestedAt: Date.now(),
            discardCacheOnCancel: discardCache
        };
    }, lockStore);

    return requested;
}

export async function waitForBookDownloadCancellation(bookId: string): Promise<boolean> {
    const deadline = Date.now() + CANCELLATION_GRACE_MS + 1000;
    while (Date.now() < deadline) {
        const current = await get<BookDownloadLock>(bookId, lockStore);
        if (!isLockActive(current)) {
            return true;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }
    return false;
}

export async function shouldDiscardBookDownloadCache(lock: BookDownloadLock | null): Promise<boolean> {
    if (!lock) {
        return false;
    }

    const current = await get<BookDownloadLock>(lock.bookId, lockStore);
    return Boolean(
        current &&
            current.taskId === lock.taskId &&
            current.cancelRequestedAt &&
            current.discardCacheOnCancel
    );
}

export async function updateBookDownloadLockTitle(lock: BookDownloadLock, bookName: string): Promise<void> {
    await update<BookDownloadLock>(lock.bookId, (current) => {
        if (!current || current.taskId !== lock.taskId || current.status === "released") {
            return current || createReleasedLock(lock);
        }
        return { ...current, bookName, heartbeatAt: Date.now() };
    }, lockStore);
}

function isLockActive(lock: BookDownloadLock | undefined, now = Date.now()): lock is BookDownloadLock {
    if (!lock || lock.status === "released" || now - lock.heartbeatAt >= LOCK_TTL_MS) {
        return false;
    }
    return !lock.cancelRequestedAt || now - lock.cancelRequestedAt < CANCELLATION_GRACE_MS;
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
        ownerSessionId: pageSessionId,
        sourcePageType,
        status: "preparing",
        startedAt: now,
        heartbeatAt: now
    };
    let result: AcquireBookLockResult | null = null;

    await update<BookDownloadLock>(bookId, (current) => {
        const isAbandonedByCurrentPage =
            current?.ownerSessionId === pageSessionId && state.activeBookLock?.taskId !== current.taskId;
        if (isLockActive(current, now) && !isAbandonedByCurrentPage) {
            result = { acquired: false, lock: current };
            return current;
        }
        result = { acquired: true, lock: candidate };
        return candidate;
    }, lockStore);

    if (!result) {
        throw new Error("无法创建下载任务锁");
    }
    return result;
}

export async function markBookDownloadRunning(lock: BookDownloadLock): Promise<boolean> {
    let updated = false;
    await update<BookDownloadLock>(lock.bookId, (current) => {
        if (!current || current.taskId !== lock.taskId || current.status === "released") {
            return current || createReleasedLock(lock);
        }
        updated = true;
        return { ...current, status: "running", heartbeatAt: Date.now() };
    }, lockStore);
    return updated;
}

export async function heartbeatBookDownloadLock(lock: BookDownloadLock): Promise<boolean> {
    let updated = false;
    await update<BookDownloadLock>(lock.bookId, (current) => {
        if (!current || current.taskId !== lock.taskId || current.status === "released") {
            return current || createReleasedLock(lock);
        }
        updated = true;
        return { ...current, heartbeatAt: Date.now() };
    }, lockStore);
    return updated;
}

export function startBookDownloadLockHeartbeat(lock: BookDownloadLock, onCancellationRequested?: () => void): () => void {
    let stopped = false;
    let refreshing = false;
    const timer = window.setInterval(() => {
        if (stopped || refreshing) {
            return;
        }
        refreshing = true;
        void heartbeatBookDownloadLock(lock)
            .then(async () => {
                if (await shouldDiscardBookDownloadCache(lock)) {
                    onCancellationRequested?.();
                }
            })
            .finally(() => {
                refreshing = false;
            });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
        stopped = true;
        window.clearInterval(timer);
    };
}

export async function releaseBookDownloadLock(lock: BookDownloadLock): Promise<void> {
    await update<BookDownloadLock>(lock.bookId, (current) => {
        if (!current || current.taskId !== lock.taskId) {
            return current || createReleasedLock(lock);
        }
        const releasedAt = Date.now();
        return { ...current, status: "released", releasedAt, heartbeatAt: releasedAt };
    }, lockStore);
}
