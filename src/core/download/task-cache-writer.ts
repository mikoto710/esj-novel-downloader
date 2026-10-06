import type { Chapter } from "../../content/model";
import type { DownloadCancellationOutcome, DownloadDependencies } from "./contracts";
import { ChapterCacheWriteBuffer } from "./cache-write-buffer";
import { createStorageError, normalizeStorageError, StorageError, toStorageFailure } from "../cache/storage-error";
import type { DownloadProgress } from "./download-progress";
import type { DownloadScope } from "./download-scope";

type CachePorts = Pick<DownloadDependencies, "cache" | "cancellation" | "lock" | "events" | "log"> & {
    scheduler: Pick<DownloadDependencies["scheduler"], "schedule">;
};

/**
 * 写入使用独立信号，普通取消仍可保存；丢弃请求会升级为终止写入
 */
export function createTaskCacheWriter(
    ports: CachePorts,
    scope: DownloadScope,
    chapters: Map<number, Chapter>,
    progress: DownloadProgress
) {
    const persistedIndexes = new Set(
        scope.options.tasks.filter((task) => chapters.has(task.index)).map((task) => task.index)
    );
    const buffer = new ChapterCacheWriteBuffer({
        write: persistTaskCacheBatch,
        schedule: ports.scheduler.schedule,
        subscribeCancellation: ports.cancellation.subscribeCancellation
    });
    /**
     * 增量写入脏章节，丢失 writer 所有权时停止旧任务
     */
    async function persistTaskCacheBatch(entries: ReadonlyMap<number, Chapter>, signal: AbortSignal): Promise<boolean> {
        ports.events.emit({ type: "cache-write-started", chapterCount: entries.size });
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const saved = await ports.cache.putBatch(
                    scope.options.bookId,
                    scope.options.taskId,
                    entries,
                    scope.meta,
                    signal
                );
                if (!saved) {
                    throw createStorageError("ownership-lost", "write");
                }
                ports.events.emit({
                    type: "cache-write-finished",
                    chapterCount: entries.size,
                    saved: true,
                    failure: null
                });
                for (const index of entries.keys()) {
                    if (scope.indexes.has(index)) {
                        persistedIndexes.add(index);
                    }
                }
                progress.update({
                    persistedCount: persistedIndexes.size
                });
                return true;
            } catch (error) {
                const normalized = normalizeStorageError(error, "write");
                if (attempt === 1 && normalized.reason !== "ownership-lost" && !signal.aborted) {
                    ports.log({
                        code: "cache-write-retry",
                        params: {
                            reason: normalized.reason,
                            operation: normalized.operation,
                            detail: normalized.params?.detail || normalized.message
                        }
                    });
                    continue;
                }
                ports.events.emit({
                    type: "cache-write-finished",
                    chapterCount: entries.size,
                    saved: false,
                    failure: toStorageFailure(normalized)
                });
                throw normalized;
            }
        }
        return false;
    }

    /**
     * 范围成功后关闭 writer，暂时写入故障允许重试一次
     */
    async function finishRangeCacheWriter(): Promise<boolean> {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                return await ports.cache.finishForTask(
                    scope.options.bookId,
                    scope.options.taskId,
                    scope.meta,
                    ports.cancellation.signal
                );
            } catch (error) {
                const normalized = normalizeStorageError(error, "write");
                if (attempt === 1 && normalized.reason !== "ownership-lost" && !ports.cancellation.signal?.aborted) {
                    ports.log({
                        code: "cache-write-retry",
                        params: {
                            reason: normalized.reason,
                            operation: normalized.operation,
                            detail: normalized.params?.detail || normalized.message
                        }
                    });
                    continue;
                }
                throw normalized;
            }
        }
        return false;
    }
    function assertHealthy(): void {
        if (buffer.failure) {
            throw new StorageError(buffer.failure);
        }
    }
    return {
        get failure() {
            return buffer.failure;
        },
        add: (index: number, chapter: Chapter) => buffer.add(index, chapter),
        invalidate: (index: number) => persistedIndexes.delete(index),
        flush: () => buffer.flush(),
        assertHealthy,
        async finish(): Promise<void> {
            if (!(await buffer.seal())) {
                assertHealthy();
                throw createStorageError("ownership-lost", "write");
            }
            // 全本成功清理整书缓存；范围成功只关闭 writer，保留已积累的章节
            const operation = scope.selection.mode === "range" ? "write" : "clear";
            try {
                const finished =
                    scope.selection.mode === "range"
                        ? await finishRangeCacheWriter()
                        : await ports.cache.clearForTask(
                              scope.options.bookId,
                              scope.options.taskId,
                              ports.cancellation.signal
                          );
                if (!finished && !ports.cancellation.isCancellationRequested()) {
                    throw createStorageError("ownership-lost", operation);
                }
            } catch (error) {
                throw normalizeStorageError(error, operation);
            }
        },
        async cancel(): Promise<DownloadCancellationOutcome> {
            const owned = await ports.lock.owns();
            const discard = await ports.lock.shouldDiscardCache();
            if (!owned || discard) {
                buffer.discard();
                ports.log({
                    code: owned ? "cancellation-cache-discard-requested" : "cancellation-cache-write-skipped-lock-lost"
                });
                return owned ? "discarded" : "ownership-lost";
            }
            ports.log({ code: "cancellation-cache-write-started" });
            const result = await buffer.flushForCancellation();
            // 保存等待中仍可能升级为丢弃，以缓冲区最终结果为准
            return result === "saved" || result === "discarded"
                ? result
                : result === "timed-out"
                  ? "save-timed-out"
                  : "save-failed";
        },
        discard: () => buffer.discard(),
        dispose: () => buffer.dispose()
    };
}
export type TaskCacheWriter = ReturnType<typeof createTaskCacheWriter>;
