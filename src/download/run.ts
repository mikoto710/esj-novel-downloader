import type { DownloadDependencies, DownloadOptions, DownloadResult } from "./contracts";
import { StorageError, toStorageFailure, createStorageError } from "../storage/cache/storage-error";
import { MappingFontError } from "../content/mapping-font";
import { createDownloadPlan } from "./plan";
import type { CacheMeta } from "../storage/cache/model";
import { DownloadProgress } from "./progress";
import { createTaskCacheWriter, type TaskCacheWriter } from "./cache-writer";
import { createChapterPipeline, type ChapterPipeline } from "./chapter-pipeline";
import { createExportData } from "../export/snapshot";
import type { BookCover } from "../content/model";
import { getErrorDetails, isCancellationError } from "./errors";
import { scanChapterIntegrity, scanMissingChapterTasks } from "./integrity";
import { runUserDecision, UserDecisionGate } from "./user-decision-gate";

class DownloadCancelled extends Error {}

/**
 * 下载并准备导出快照；取消返回明确结果，失败抛出，页面负责展示导出入口
 */
export async function runDownload(
    options: DownloadOptions,
    dependencies: DownloadDependencies
): Promise<DownloadResult> {
    const { chapters, cancellation, ui, events, log } = dependencies;
    const plan = createDownloadPlan(options);
    const meta: CacheMeta = {
        bookId: options.bookId,
        bookName: options.bookName,
        rawBookName: options.rawBookName || options.bookName,
        author: options.author || "未知作者",
        pageUrl: options.pageUrl || dependencies.fallbackPageUrl,
        totalChapters: plan.selection.sourceTotalChapters,
        sourcePageType: options.sourcePageType || "unknown",
        imageEnabled: options.imageEnabled,
        updatedAt: dependencies.startedAt
    };
    const ports = { ...dependencies, concurrency: Math.max(1, Math.floor(dependencies.concurrency) || 1) };
    const progress = new DownloadProgress(plan, chapters, events, ui);
    const cache = createTaskCacheWriter(ports, options, plan, meta, chapters, progress);
    // 字体、密码和缺章选择共享任务内唯一的决策队列
    const decisions = new UserDecisionGate();
    const pipeline = createChapterPipeline(ports, plan, options.imageEnabled, meta.pageUrl, progress, cache, decisions);

    function checkActive(): void {
        if (cancellation.isCancellationRequested()) {
            throw new DownloadCancelled();
        }
        cache.assertHealthy();
    }
    async function flush(
        code: "download-main-flush-started" | "download-integrity-flush-started" | "missing-chapter-retry-saved"
    ): Promise<void> {
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
        ui.prepare(plan.selection);
        events.emit({
            type: "task-started",
            meta: meta,
            taskId: options.taskId,
            bookChapterCount: chapters.size
        });
        const restoredCount = plan.readyCount(chapters);
        if (restoredCount) {
            log({ code: "cache-restore-started", params: { count: restoredCount } });
        }

        progress.transition("restoring-cache");
        const restored = await pipeline.restore();
        checkActive();
        if (!restored) {
            throw createStorageError("ownership-lost", "write");
        }
        const cover = prepareCover(options, dependencies);

        progress.transition("downloading");
        await pipeline.download();
        checkActive();

        // 每轮补抓都先落盘，再决定是否还需补章
        await flush("download-main-flush-started");
        progress.transition("checking-integrity");
        log({ code: "integrity-check-started" });
        const issues = scanChapterIntegrity(plan.tasks, chapters, options.imageEnabled);
        progress.update({ retryPendingCount: issues.length, failedCount: issues.length });
        log(
            issues.length
                ? { code: "integrity-check-failed", params: { count: issues.length } }
                : { code: "integrity-check-passed" }
        );
        if (issues.length) {
            await pipeline.retry(issues);
            checkActive();
        }
        await flush("download-integrity-flush-started");
        if (issues.length) {
            progress.update({
                retryPendingCount: 0,
                failedCount: scanChapterIntegrity(plan.tasks, chapters, options.imageEnabled).length
            });
        }

        while (true) {
            checkActive();
            const missingTasks = scanMissingChapterTasks(plan.tasks, chapters);
            progress.update({ retryPendingCount: 0, failedCount: missingTasks.length });
            if (!missingTasks.length) {
                break;
            }
            if (progress.snapshot.phase === "flushing-cache") {
                progress.transition("checking-integrity");
            }
            // 自动补抓仍有缺章，才要求用户决定下一步；图片异常不进入缺正文决策
            const decision = await runUserDecision(
                decisions,
                cancellation,
                () =>
                    ui.confirmIncompleteChapters(
                        {
                            missingTasks,
                            totalChapters: plan.tasks.length,
                            ...(plan.selection.mode === "range"
                                ? {
                                      sourceTotalChapters: plan.selection.sourceTotalChapters,
                                      selectionMode: plan.selection.mode,
                                      taskOrderByIndex: plan.taskOrderByIndex
                                  }
                                : {})
                        },
                        cancellation.signal
                    ),
                "cancel"
            );
            events.emit({ type: "incomplete-chapters-decided", missingCount: missingTasks.length, decision });
            if (cancellation.isCancellationRequested() || decision === "cancel") {
                if (!cancellation.isCancellationRequested()) {
                    cancellation.requestCancellation("flush");
                }
                checkActive();
            }
            if (decision === "export-with-placeholders") {
                log({ code: "missing-chapter-export-with-placeholders", params: { count: missingTasks.length } });
                break;
            }
            log({ code: "missing-chapter-retry-started", params: { count: missingTasks.length } });
            await pipeline.retry(
                missingTasks.map((task) => ({ task, reason: "missing" })),
                true
            );
            checkActive();
            // 新补章节先落盘，再重新计算缺章列表，输出始终沿用原计划
            await flush("missing-chapter-retry-saved");
        }
        checkActive();

        progress.transition("preparing-export");
        log({ code: "export-preparation-started" });
        const bookCover = await cover;
        checkActive();
        // 构造快照后完成缓存收尾，再返回导出结果，避免成功后仍有后台写入
        const data = createExportData(options, plan, meta.pageUrl, chapters, bookCover, progress.snapshot.failedCount);
        await cache.finish();
        checkActive();
        progress.update({
            completedCount: plan.tasks.length,
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
        try {
            pipeline.dispose();
        } finally {
            cache.dispose();
        }
    }
}

// 取消只在此收尾一次，缓存处理结果决定最终提示
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
// 统一记录失败并关闭进度界面，不覆盖之前的导出结果
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

type CoverPorts = Pick<DownloadDependencies, "coverCache" | "coverFetcher" | "cancellation" | "log">;
// 优先复用封面缓存，封面缺失不阻断正文导出
async function prepareCover(options: DownloadOptions, ports: CoverPorts): Promise<BookCover | null> {
    const coverUrl = options.coverUrl;
    if (!coverUrl) {
        return null;
    }

    try {
        const cached = await ports.coverCache.load(options.bookId, coverUrl);
        if (cached) {
            ports.log({ code: "cover-cache-hit" });
            return cached;
        }
    } catch (error) {
        ports.log({ code: "cover-cache-read-failed", params: getErrorDetails(error) });
    }

    if (ports.cancellation.isCancellationRequested()) {
        return null;
    }
    const cover = await ports.coverFetcher.fetch(coverUrl, ports.cancellation.signal);
    if (!cover || ports.cancellation.isCancellationRequested()) {
        return null;
    }

    try {
        const saved = await ports.coverCache.put(
            options.bookId,
            options.taskId,
            coverUrl,
            cover,
            ports.cancellation.signal
        );
        ports.log({
            code: saved ? "cover-cache-saved" : "cover-cache-write-ownership-lost"
        });
    } catch (error) {
        ports.log({ code: "cover-cache-write-failed", params: getErrorDetails(error) });
    }
    return cover;
}
