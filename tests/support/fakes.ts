import type { DownloadTask } from "../../src/core/download/contracts";
import type { BookDownloadLock, CacheStatus, Chapter } from "../../src/types";
import { createAbortError, createDeferred, type Deferred } from "./async";
import { createBookLock, createChapter } from "./factories";

type FetchPlan =
    | { type: "success"; html: string }
    | { type: "failure"; error: Error }
    | { type: "deferred"; deferred: Deferred<string> };

/**
 * 按预设结果模拟章节请求，并记录调用顺序
 */
export class FakeChapterFetcher {
    readonly calls: DownloadTask[] = [];
    private readonly plans = new Map<string, FetchPlan[]>();

    succeed(url: string, html: string): this {
        return this.enqueue(url, { type: "success", html });
    }

    fail(url: string, error: Error = new Error("fetch failed")): this {
        return this.enqueue(url, { type: "failure", error });
    }

    defer(url: string): Deferred<string> {
        const deferred = createDeferred<string>();
        this.enqueue(url, { type: "deferred", deferred });
        return deferred;
    }

    async fetch(task: DownloadTask, signal?: AbortSignal): Promise<string> {
        this.calls.push({ ...task });
        if (signal?.aborted) {
            throw createAbortError();
        }

        const plan = this.plans.get(task.url)?.shift() ?? { type: "success", html: `<p>${task.title}</p>` };
        if (plan.type === "failure") {
            throw plan.error;
        }
        if (plan.type === "success") {
            return plan.html;
        }
        return waitForDeferred(plan.deferred, signal);
    }

    private enqueue(url: string, plan: FetchPlan): this {
        const queue = this.plans.get(url) ?? [];
        queue.push(plan);
        this.plans.set(url, queue);
        return this;
    }
}

type ProcessorPlan =
    | { type: "success"; chapter: Chapter }
    | { type: "failure"; error: Error }
    | { type: "deferred"; deferred: Deferred<Chapter> };

/**
 * 按章节索引模拟内容处理，并记录处理输入
 */
export class FakeChapterProcessor {
    readonly calls: Array<{ html: string; task: DownloadTask }> = [];
    private readonly plans = new Map<number, ProcessorPlan>();

    succeed(index: number, chapter: Chapter = createChapter(index)): this {
        this.plans.set(index, { type: "success", chapter });
        return this;
    }

    fail(index: number, error: Error = new Error("process failed")): this {
        this.plans.set(index, { type: "failure", error });
        return this;
    }

    defer(index: number): Deferred<Chapter> {
        const deferred = createDeferred<Chapter>();
        this.plans.set(index, { type: "deferred", deferred });
        return deferred;
    }

    async process(html: string, task: DownloadTask, signal?: AbortSignal): Promise<Chapter> {
        this.calls.push({ html, task: { ...task } });
        if (signal?.aborted) {
            throw createAbortError();
        }
        const plan = this.plans.get(task.index) ?? { type: "success", chapter: createChapter(task.index) };
        if (plan.type === "failure") {
            throw plan.error;
        }
        if (plan.type === "deferred") {
            return waitForDeferred(plan.deferred, signal);
        }
        return structuredCloneChapter(plan.chapter);
    }
}

/**
 * 内存缓存清单
 */
export interface InMemoryCacheManifest {
    bookId: string;
    writerTaskId: string;
    status: CacheStatus | "failed";
}

/**
 * 内存缓存操作记录
 */
export type CacheOperation =
    | { type: "claim"; bookId: string; taskId: string }
    | { type: "load"; bookId: string }
    | { type: "put"; bookId: string; taskId: string; indexes: number[] }
    | { type: "status"; bookId: string; taskId: string; status: InMemoryCacheManifest["status"] }
    | { type: "delete"; bookId: string; taskId: string };

/**
 * 模拟具有任务所有权约束的缓存仓储
 */
export class InMemoryCacheRepository {
    readonly operations: CacheOperation[] = [];
    private readonly manifests = new Map<string, InMemoryCacheManifest>();
    private readonly chapters = new Map<string, Map<number, Chapter>>();

    seed(
        bookId: string,
        entries: ReadonlyMap<number, Chapter>,
        writerTaskId = `seed-${bookId}`,
        status: InMemoryCacheManifest["status"] = "cancelled"
    ): this {
        this.manifests.set(bookId, { bookId, writerTaskId, status });
        this.chapters.set(
            bookId,
            new Map(Array.from(entries, ([index, chapter]) => [index, structuredCloneChapter(chapter)]))
        );
        return this;
    }

    async claim(bookId: string, taskId: string): Promise<Map<number, Chapter>> {
        this.operations.push({ type: "claim", bookId, taskId });
        this.manifests.set(bookId, { bookId, writerTaskId: taskId, status: "downloading" });
        return this.cloneChapterMap(bookId);
    }

    async load(bookId: string): Promise<Map<number, Chapter>> {
        this.operations.push({ type: "load", bookId });
        return this.cloneChapterMap(bookId);
    }

    async putBatch(bookId: string, taskId: string, entries: ReadonlyMap<number, Chapter>): Promise<void> {
        this.assertOwner(bookId, taskId);
        const target = this.chapters.get(bookId) ?? new Map<number, Chapter>();
        for (const [index, chapter] of entries) {
            target.set(index, structuredCloneChapter(chapter));
        }
        this.chapters.set(bookId, target);
        this.operations.push({ type: "put", bookId, taskId, indexes: Array.from(entries.keys()) });
    }

    async markStatus(bookId: string, taskId: string, status: InMemoryCacheManifest["status"]): Promise<void> {
        this.assertOwner(bookId, taskId);
        this.manifests.set(bookId, { bookId, writerTaskId: taskId, status });
        this.operations.push({ type: "status", bookId, taskId, status });
    }

    async deleteForTask(bookId: string, taskId: string): Promise<void> {
        this.assertOwner(bookId, taskId);
        this.manifests.delete(bookId);
        this.chapters.delete(bookId);
        this.operations.push({ type: "delete", bookId, taskId });
    }

    owns(bookId: string, taskId: string): boolean {
        return this.manifests.get(bookId)?.writerTaskId === taskId;
    }

    getManifest(bookId: string): InMemoryCacheManifest | null {
        const manifest = this.manifests.get(bookId);
        return manifest ? { ...manifest } : null;
    }

    private assertOwner(bookId: string, taskId: string): void {
        if (!this.owns(bookId, taskId)) {
            throw new Error(`ownership-lost:${bookId}:${taskId}`);
        }
    }

    private cloneChapterMap(bookId: string): Map<number, Chapter> {
        return new Map(
            Array.from(this.chapters.get(bookId)?.entries() ?? [], ([index, chapter]) => [
                index,
                structuredCloneChapter(chapter)
            ])
        );
    }
}

/**
 * 下载锁操作记录
 */
export type LockOperation =
    | { type: "acquire"; bookId: string }
    | { type: "running"; bookId: string; taskId: string }
    | { type: "heartbeat"; bookId: string; taskId: string }
    | { type: "cancel"; bookId: string; discard: boolean }
    | { type: "release"; bookId: string; taskId: string };

/**
 * 模拟下载锁竞争、心跳和取消请求
 */
export class FakeBookLockService {
    readonly operations: LockOperation[] = [];
    private readonly locks = new Map<string, BookDownloadLock>();
    private readonly conflicts = new Map<string, BookDownloadLock>();

    setConflict(bookId: string, lock = createBookLock({ bookId, taskId: `conflict-${bookId}` })): this {
        this.conflicts.set(bookId, lock);
        return this;
    }

    async acquire(
        bookId: string
    ): Promise<{ acquired: true; lock: BookDownloadLock } | { acquired: false; lock: BookDownloadLock }> {
        this.operations.push({ type: "acquire", bookId });
        const conflict = this.conflicts.get(bookId);
        if (conflict) {
            return { acquired: false, lock: { ...conflict } };
        }
        const lock = createBookLock({ bookId, taskId: `task-${bookId}` });
        this.locks.set(bookId, lock);
        return { acquired: true, lock: { ...lock } };
    }

    async markRunning(lock: BookDownloadLock): Promise<boolean> {
        if (!this.owns(lock)) {
            return false;
        }
        this.locks.set(lock.bookId, { ...lock, status: "running" });
        this.operations.push({ type: "running", bookId: lock.bookId, taskId: lock.taskId });
        return true;
    }

    owns(lock: BookDownloadLock): boolean {
        return this.locks.get(lock.bookId)?.taskId === lock.taskId;
    }

    async heartbeat(lock: BookDownloadLock): Promise<boolean> {
        if (!this.owns(lock)) {
            return false;
        }
        const current = this.locks.get(lock.bookId)!;
        this.locks.set(lock.bookId, { ...current, heartbeatAt: Date.now() });
        this.operations.push({ type: "heartbeat", bookId: lock.bookId, taskId: lock.taskId });
        return true;
    }

    replaceOwner(bookId: string, taskId = `replacement-${bookId}`): BookDownloadLock {
        const replacement = createBookLock({ bookId, taskId, status: "running" });
        this.locks.set(bookId, replacement);
        return { ...replacement };
    }

    getLock(bookId: string): BookDownloadLock | null {
        const lock = this.locks.get(bookId);
        return lock ? { ...lock } : null;
    }

    async requestCancellation(bookId: string, discard: boolean): Promise<boolean> {
        const lock = this.locks.get(bookId);
        if (!lock) {
            return false;
        }
        this.locks.set(bookId, {
            ...lock,
            cancelRequestedAt: Date.now(),
            discardCacheOnCancel: discard
        });
        this.operations.push({ type: "cancel", bookId, discard });
        return true;
    }

    async release(lock: BookDownloadLock): Promise<void> {
        if (this.owns(lock)) {
            this.locks.delete(lock.bookId);
        }
        this.operations.push({ type: "release", bookId: lock.bookId, taskId: lock.taskId });
    }
}

/**
 * 记录下载核心发布的事件
 */
export class RecordingDownloadEvents<TEvent = unknown> {
    readonly events: TEvent[] = [];

    emit(event: TEvent): void {
        this.events.push(event);
    }

    ofType<TType extends string>(type: TType): TEvent[] {
        return this.events.filter(
            (event) => typeof event === "object" && event !== null && "type" in event && event.type === type
        );
    }
}

/**
 * 记录下载核心提交的界面快照
 */
export class RecordingUiObserver<TSnapshot = unknown> {
    readonly snapshots: TSnapshot[] = [];

    update(snapshot: TSnapshot): void {
        this.snapshots.push(snapshot);
    }

    latest(): TSnapshot | undefined {
        return this.snapshots.at(-1);
    }
}

async function waitForDeferred<T>(deferred: Deferred<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
        return deferred.promise;
    }
    return new Promise<T>((resolve, reject) => {
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        const onAbort = () => {
            cleanup();
            reject(createAbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        deferred.promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            }
        );
    });
}

function structuredCloneChapter(chapter: Chapter): Chapter {
    return {
        ...chapter,
        images: chapter.images?.map((image) => ({ ...image }))
    };
}
