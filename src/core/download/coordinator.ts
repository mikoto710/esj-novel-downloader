import type { DownloadDependencies, DownloadOptions, DownloadResult } from "./contracts";
import { StorageError, toStorageFailure, createStorageError } from "../cache/storage-error";
import { MappingFontError } from "../mapping-font";
import { createDownloadScope } from "./download-scope";
import { DownloadProgress } from "./download-progress";
import { createTaskCacheWriter, type TaskCacheWriter } from "./task-cache-writer";
import { createChapterPipeline, type ChapterPipeline } from "./chapter-pipeline";
import { createExportData, prepareCover } from "./export-data";
import { getErrorDetails, isCancellationError } from "./errors";

class DownloadCancelled extends Error {}

/**
 * 下载并准备导出快照；取消返回明确结果，失败抛出，页面负责展示导出入口
 */
export async function runDownload(
    options: DownloadOptions,
    dependencies: DownloadDependencies
): Promise<DownloadResult> {
    const { chapters, cancellation, ui, events, log } = dependencies;
    const scope = createDownloadScope(options, dependencies);
    const ports = { ...dependencies, concurrency: Math.max(1, Math.floor(dependencies.concurrency) || 1) };
    const progress = new DownloadProgress(scope, chapters, events, ui);
    const cache = createTaskCacheWriter(ports, scope, chapters, progress);
    const pipeline = createChapterPipeline(ports, scope, progress, cache);

    function checkActive(): void {
        if (cancellation.isCancellationRequested()) {
            throw new DownloadCancelled();
        }
        cache.assertHealthy();
    }
    async function flush(code: "download-main-flush-started" | "download-integrity-flush-started"): Promise<void> {
        progress.transition("flushing-cache");
        log({ code });
        const saved = await cache.flush();
        checkActive();
        if (!saved) {
            throw createStorageError("ownership-lost", "write");
        }
    }

    try {
        progress.transition("preparing");
        ui.prepare(scope.selection);
        events.emit({
            type: "task-started",
            meta: scope.meta,
            taskId: options.taskId,
            bookChapterCount: chapters.size
        });
        const restoredCount = scope.readyCount(chapters);
        if (restoredCount) {
            log({ code: "cache-restore-started", params: { count: restoredCount } });
        }

        progress.transition("restoring-cache");
        const restored = await pipeline.restore();
        checkActive();
        if (!restored) {
            throw createStorageError("ownership-lost", "write");
        }
        const cover = prepareCover(scope, dependencies);

        progress.transition("downloading");
        await pipeline.download();
        checkActive();

        // 每轮补抓都先落盘，再决定是否还需补章
        await flush("download-main-flush-started");
        progress.transition("checking-integrity");
        await pipeline.checkIntegrity();
        checkActive();
        await flush("download-integrity-flush-started");
        await pipeline.resolveIncomplete();
        checkActive();

        progress.transition("preparing-export");
        log({ code: "export-preparation-started" });
        const bookCover = await cover;
        checkActive();
        // 先封闭缓存 writer，再发布导出结果，避免成功后仍有后台写入
        const data = createExportData(scope, chapters, bookCover, progress.snapshot.failedCount);
        await cache.finish();
        checkActive();
        progress.update({
            completedCount: options.tasks.length,
            hasExportData: true
        });
        progress.transition("export-ready");
        log({ code: "download-completed" });
        ui.cleanup();
        return { status: "ready", data };
    } catch (error) {
        if (
            error instanceof DownloadCancelled ||
            (cancellation.isCancellationRequested() && isCancellationError(error))
        ) {
            try {
                return await finishCancellation(dependencies, progress, cache);
            } catch (cancellationError) {
                return reportFailure(cancellationError, dependencies, progress, cache, pipeline);
            }
        }
        return reportFailure(error, dependencies, progress, cache, pipeline);
    } finally {
        pipeline.dispose();
        cache.dispose();
    }
}

/**
 * 取消只在此收尾一次，缓存处理结果决定最终提示
 */
async function finishCancellation(
    dependencies: Pick<DownloadDependencies, "ui" | "log" | "scheduler">,
    progress: DownloadProgress,
    cache: TaskCacheWriter
): Promise<DownloadResult> {
    const { ui, log } = dependencies;
    progress.update({ cancellationRequested: true, hasExportData: false, protectedPendingCount: 0 });
    progress.transition("cancelling");
    const outcome = await cache.cancel();
    const storageFailure = cache.failure;
    progress.update({ cancellationOutcome: outcome, storageFailure });
    progress.transition("cancelled");
    log({
        code: "cancellation-finished",
        params: {
            outcome,
            ...(storageFailure
                ? {
                      storageReason: storageFailure.reason,
                      storageOperation: storageFailure.operation,
                      detail: storageFailure.params?.detail || storageFailure.message
                  }
                : {})
        }
    });
    await dependencies.scheduler.sleep(800);
    ui.cleanup();
    if (outcome !== "saved" && outcome !== "discarded") {
        ui.showTerminalFailure({ kind: "cancellation", outcome, storageFailure });
    }
    return { status: "cancelled", outcome };
}
/**
 * 统一记录失败并关闭进度界面，不覆盖之前的导出结果
 */
function reportFailure(
    error: unknown,
    dependencies: Pick<DownloadDependencies, "ui" | "log" | "events">,
    progress: DownloadProgress,
    cache: TaskCacheWriter,
    pipeline: ChapterPipeline
): never {
    const { ui, log, events } = dependencies;
    const reported =
        error instanceof StorageError
            ? error
            : cache.failure
              ? new StorageError(cache.failure, { cause: error })
              : error;
    if (reported instanceof StorageError) {
        const failure = toStorageFailure(reported);
        progress.update({ storageFailure: failure });
        log({
            code: "download-storage-failed",
            params: {
                reason: failure.reason,
                operation: failure.operation,
                detail: failure.params?.detail || failure.message
            }
        });
    }
    cache.discard();
    if (progress.snapshot.phase !== "failed" && progress.snapshot.phase !== "cancelled") {
        progress.transition("failed");
    }
    const details = getErrorDetails(reported);
    const storageFailure = progress.snapshot.storageFailure;
    const code = storageFailure?.reason || details.name || "download-failed";
    const params = storageFailure
        ? { operation: storageFailure.operation, ...(storageFailure.params || {}) }
        : { errorName: details.name, detail: details.message };
    events.emit({ type: "download-failed", code, params, snapshot: progress.snapshot });
    ui.cleanup();
    if (reported instanceof MappingFontError && pipeline.mappingFailures.length) {
        ui.showMappingFontFailure(pipeline.mappingFailures);
    } else {
        ui.showTerminalFailure({ kind: "download", code, params, storageFailure });
    }
    throw reported;
}
