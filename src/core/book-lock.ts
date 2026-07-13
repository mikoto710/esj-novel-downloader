import { createStore, update } from "idb-keyval";
import { BookDownloadLock, SourcePageType } from "../types";

const LOCK_TTL_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 10 * 1000;
const lockStore = createStore("esj-novel-downloader", "book-download-locks");

export type FullBookSourcePageType = Extract<SourcePageType, "detail" | "forum">;
export type AcquireBookLockResult =
    | { acquired: true; lock: BookDownloadLock }
    | { acquired: false; lock: BookDownloadLock };

function isLockActive(lock: BookDownloadLock | undefined, now = Date.now()): lock is BookDownloadLock {
    return Boolean(lock && lock.status !== "released" && now - lock.heartbeatAt < LOCK_TTL_MS);
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
    let result: AcquireBookLockResult | null = null;

    await update<BookDownloadLock>(bookId, (current) => {
        if (isLockActive(current, now)) {
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

export function startBookDownloadLockHeartbeat(lock: BookDownloadLock): () => void {
    let stopped = false;
    let refreshing = false;
    const timer = window.setInterval(() => {
        if (stopped || refreshing) {
            return;
        }
        refreshing = true;
        void heartbeatBookDownloadLock(lock).finally(() => {
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
