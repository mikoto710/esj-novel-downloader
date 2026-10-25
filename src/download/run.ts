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
 * 下载并准备导出快照；返回 ready/cancelled/failed，应用负责整次任务窗口与终态呈现
 */
export async function runDownload(
    options: DownloadOptions,
    dependencies: DownloadDependencies
): Promise<DownloadResult> {
    const { cancellation } = dependencies;
    // 只隔离单向观察；确认/密码等业务决策仍直接 await，真实异常进入失败分支
    const log: DownloadDependencies["log"] = (message) => {
        try {
            dependencies.log(message);
        } catch {
            // 日志故障不能改写业务结果
        }
    };
    const events: DownloadDependencies["events"] = {
        emit(event) {
            try {
                dependencies.events.emit(event);
            } catch {
                // 诊断与页面摘要均为观察
            }
        }
    };
    const ui: DownloadDependencies["ui"] = {
        ...dependencies.ui,
        update(snapshot) {
            try {
                dependencies.ui.update(snapshot);
            } catch {
                // 进度呈现失败不阻断正文
            }
        },
        updateMappingFontWarning(summary) {
            try {
                dependencies.ui.updateMappingFontWarning(summary);
            } catch {
                // 摘要不替代字体确认
            }
        }
    };
    const chapters = new Map(options.initialChapters);
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
    // 用户取消与致命失败分开：失败只停止工作，不伪造用户取消或启动保存
    const work = new AbortController();
    let failed = false;
    let firstFailure: unknown;
    const abortWork = () => work.abort();
    cancellation.signal?.addEventListener("abort", abortWork, { once: true });
    if (cancellation.isCancellationRequested()) {
        work.abort();
    }
    let cover: Promise<BookCover | null> = Promise.resolve(null);

    function stopOnFailure(error: unknown): void {
        if (!failed) {
            failed = true;
            firstFailure = error;
            cache.discard();
            work.abort();
        }
    }

    const ports = {
        ...dependencies,
        events,
        log,
        ui,
        workSignal: work.signal,
        stopOnFailure,
        concurrency: Math.max(1, Math.floor(dependencies.concurrency) || 1)
    };
    const progress = new DownloadProgress(plan, chapters, events, ui);
    const cache = createTaskCacheWriter(ports, options, plan, meta, progress);

    // 字体、密码和缺章选择共享任务内唯一的决策队列
    const decisions = new UserDecisionGate();
    const pipeline = createChapterPipeline(
        ports,
        chapters,
        plan,
        options.imageEnabled,
        meta.pageUrl,
        progress,
        cache,
        decisions
    );

    function checkActive(): void {
        if (failed) {
            throw firstFailure;
        }
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
        const committed = await cache.flush();
        checkActive();
        if (!committed) {
            throw createStorageError("ownership-lost", "write");
        }
    }

    let result: DownloadResult | undefined;
    try {
        progress.transition("preparing");
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
        // 封面与正文并行；正文完成和缺章决策结束后再等待封面
        cover = prepareCover(options, ports, work.signal).catch(() => null);

        progress.transition("downloading");
        await pipeline.download();
        checkActive();

        // 每轮补抓都先落盘，再决定是否还需补章
        await flush("download-main-flush-started");
        progress.transition("checking-integrity");
        log({ code: "integrity-check-started" });
        const issues = scanChapterIntegrity(plan.tasks, chapters, options.imageEnabled);
        progress.recordIntegrityScan(issues.length, issues.length);
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
            progress.recordIntegrityScan(scanChapterIntegrity(plan.tasks, chapters, options.imageEnabled).length);
        }

        // 缺正文决策循环保持在主流程：询问 → 补抓或占位 → 落盘 → 再检查
        while (true) {
            checkActive();
            const missingTasks = scanMissingChapterTasks(plan.tasks, chapters);
            progress.recordIntegrityScan(missingTasks.length);
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
                            ...(plan.selection.mode === "selected"
                                ? {
                                      sourceTotalChapters: plan.selection.sourceTotalChapters,
                                      selectionMode: plan.selection.mode,
                                      taskOrderByIndex: plan.taskOrderByIndex
                                  }
                                : {})
                        },
                        work.signal
                    ),
                "cancel",
                work.signal
            );
            checkActive();
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
        progress.recordExportReady();
        progress.transition("export-ready");
        log({ code: "download-completed" });
        result = { status: "ready", data };
    } catch (error) {
        if (
            !failed &&
            (error instanceof DownloadCancelled ||
                (cancellation.isCancellationRequested() && isCancellationError(error)))
        ) {
            try {
                result = await finishCancellation(ports, progress, cache);
            } catch (cancellationError) {
                result = reportFailure(cancellationError, ports, progress, cache, pipeline);
            }
        } else {
            stopOnFailure(error);
            result = reportFailure(firstFailure, ports, progress, cache, pipeline);
        }
    } finally {
        // 所有终态都等待封面与活动事务，不遗弃仍可能回写状态的 Promise
        work.abort();
        await cover;
        await cache.flush();
        cancellation.signal?.removeEventListener("abort", abortWork);
        try {
            pipeline.dispose();
        } catch (error) {
            // 资源结束失败也交接给应用，已确定的原失败保留优先权
            if (!result || result.status !== "failed") {
                result = reportFailure(error, ports, progress, cache, pipeline);
            }
        } finally {
            cache.dispose();
        }
    }
    return result!;
}

// 取消只在此收尾一次，缓存处理结果决定最终提示
async function finishCancellation(
    dependencies: Pick<DownloadDependencies, "log" | "scheduler">,
    progress: DownloadProgress,
    cache: TaskCacheWriter
): Promise<DownloadResult> {
    const { log } = dependencies;
    progress.recordCancellationRequested();
    progress.transition("cancelling");
    const outcome = await cache.cancel();
    const storageFailure = cache.failure;
    progress.recordCancellationFinished(outcome, storageFailure);
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
    return { status: "cancelled", outcome, storageFailure };
}

// 记录并返回完整失败原因；任务窗口与旧导出仍由应用持有
function reportFailure(
    error: unknown,
    dependencies: Pick<DownloadDependencies, "log" | "events">,
    progress: DownloadProgress,
    cache: TaskCacheWriter,
    pipeline: ChapterPipeline
): DownloadResult {
    const { log, events } = dependencies;
    const reported = error;
    if (reported instanceof StorageError) {
        const failure = toStorageFailure(reported);
        progress.recordStorageFailure(failure);
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
    const failure =
        reported instanceof MappingFontError && pipeline.mappingFailures.length
            ? { kind: "mapping-font" as const, failures: pipeline.mappingFailures }
            : { kind: "download" as const, code, params, storageFailure };
    return { status: "failed", failure };
}

type CoverPorts = Pick<DownloadDependencies, "coverCache" | "coverFetcher" | "cancellation" | "log">;

// 优先复用封面缓存，封面缺失不阻断正文导出
async function prepareCover(
    options: DownloadOptions,
    ports: CoverPorts,
    signal: AbortSignal
): Promise<BookCover | null> {
    const coverUrl = options.coverUrl;
    if (!coverUrl) {
        return null;
    }

    try {
        const cached = await ports.coverCache.load(options.bookId, coverUrl);
        if (signal.aborted) {
            return null;
        }
        if (cached) {
            ports.log({ code: "cover-cache-hit" });
            return cached;
        }
    } catch (error) {
        if (!signal.aborted) {
            ports.log({ code: "cover-cache-read-failed", params: getErrorDetails(error) });
        }
    }

    if (signal.aborted) {
        return null;
    }
    let cover: BookCover | null;
    try {
        cover = await ports.coverFetcher.fetch(coverUrl, signal);
    } catch {
        return null;
    }
    if (!cover || signal.aborted) {
        return null;
    }

    try {
        const saved = await ports.coverCache.put(options.bookId, options.taskId, coverUrl, cover, signal);
        if (signal.aborted) {
            return null;
        }
        ports.log({
            code: saved ? "cover-cache-saved" : "cover-cache-write-ownership-lost"
        });
    } catch (error) {
        if (!signal.aborted) {
            ports.log({ code: "cover-cache-write-failed", params: getErrorDetails(error) });
        }
    }
    return cover;
}
