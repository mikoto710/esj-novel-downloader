import type { DownloadTask } from "../../src/download/contracts";
import type { CacheStatus } from "../../src/types";
import type { Chapter } from "../../src/content/model";
import { createAbortError, createDeferred, type Deferred } from "./async";

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
        ...(chapter.images === undefined ? {} : { images: chapter.images.map((image) => ({ ...image })) })
    };
}
