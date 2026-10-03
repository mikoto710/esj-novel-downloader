import type { Chapter } from "../../types";
import type { DownloadDependencies, DownloadTask } from "./contracts";
import type { DownloadScope } from "./download-scope";
import type { DownloadProgress } from "./download-progress";
import type { TaskCacheWriter } from "./task-cache-writer";
import type { MappedChapters } from "./mapped-chapters";
import { createProtectedChapters, type ChapterTaskResult } from "./protected-chapters";
import { scanChapterIntegrity, scanMissingChapterTasks, type ChapterIntegrityIssue } from "./integrity";
import { DEFAULT_CHAPTER_RETRY_POLICY, runWithRetry } from "./retry-policy";
import { runWorkerPool } from "./worker-pool";
import { runUserDecision, UserDecisionGate } from "./user-decision-gate";
import { MappingFontError } from "../mapping-font";
import { getErrorDetails } from "./errors";

type ChapterPorts = Pick<
    DownloadDependencies,
    "cancellation" | "chapterFetcher" | "chapterProcessor" | "protectedChapterDetector" | "scheduler" | "log" | "events"
> & {
    ui: Pick<DownloadDependencies["ui"], "confirmIncompleteChapters">;
};

/**
 * 正文抓取、自动补抓和缺章选择复用同一条处理路径
 */
export function createChapterPipeline(
    ports: ChapterPorts,
    scope: DownloadScope,
    chapters: Map<number, Chapter>,
    progress: DownloadProgress,
    cache: TaskCacheWriter,
    mapping: MappedChapters,
    protectedChapters: ReturnType<typeof createProtectedChapters>,
    decisions: UserDecisionGate
) {
    const shouldStop = () => ports.cancellation.isCancellationRequested() || Boolean(cache.failure);
    /**
     * 按既有重试策略获取正文，普通失败交给后续完整性检查
     */
    async function downloadChapterHtml(task: DownloadTask, isRetry: boolean): Promise<string | null> {
        const result = await runWithRetry({
            policy: DEFAULT_CHAPTER_RETRY_POLICY,
            operation: () => ports.chapterFetcher.fetch(task, ports.cancellation.signal),
            sleep: ports.scheduler.sleepWithAbort,
            isCancellationRequested: ports.cancellation.isCancellationRequested,
            isCancellationError: (error) => getErrorDetails(error).name === "AbortError"
        });
        if (result.status === "success") {
            return result.value;
        }
        if (result.status === "failed") {
            const details = getErrorDetails(result.error);
            ports.log({
                code: "chapter-fetch-failed",
                params: {
                    ...scope.position(task),
                    title: task.title,
                    errorName: details.name,
                    detail: details.message,
                    retry: isRetry
                }
            });
            ports.events.emit({
                type: "chapter-failed",
                task,
                stage: "fetch",
                code: "chapter-fetch-failed",
                params: {
                    ...scope.position(task),
                    title: task.title,
                    errorName: details.name,
                    detail: details.message
                },
                retry: isRetry
            });
        }
        return null;
    }

    /**
     * 解析正文并增量落盘，映射字体需先获得用户确认
     */
    async function processFetchedChapterHtml(
        task: DownloadTask,
        html: string,
        isRetry: boolean
    ): Promise<ChapterTaskResult> {
        let chapter: Chapter;
        try {
            chapter = await ports.chapterProcessor.process(
                html,
                task,
                scope.options.imageEnabled,
                ports.cancellation.signal
            );
            mapping.clearFailure(task.index);
        } catch (error) {
            if (!(error instanceof MappingFontError)) {
                throw error;
            }
            mapping.recordFailure(task, error);
            ports.log({
                code: "chapter-mapping-font-failed",
                params: {
                    ...scope.position(task),
                    title: task.title,
                    errorCode: error.code,
                    reason: error.reason,
                    ...error.params
                }
            });
            ports.events.emit({
                type: "chapter-failed",
                task,
                stage: "mapping-font",
                code: error.code,
                params: {
                    ...scope.position(task),
                    title: task.title,
                    reason: error.reason,
                    ...error.params
                },
                retry: isRetry
            });
            if (!isRetry) {
                progress.update({
                    completedCount: progress.snapshot.completedCount + 1,
                    failedCount: progress.snapshot.failedCount + 1
                });
            }
            return "failed";
        }
        if (ports.cancellation.isCancellationRequested()) {
            return "cancelled";
        }
        // 确认期间允许已完成的章节落盘，但暂停领取新任务
        const mappingConsent = mapping.register(task, chapter);
        chapters.set(task.index, chapter);
        ports.events.emit({ type: "chapter-processed", task, retry: isRetry });

        progress.update({
            completedCount: progress.snapshot.completedCount + (isRetry ? 0 : 1),
            processedCount: progress.snapshot.processedCount + 1
        });

        const saved = await cache.add(task.index, chapter);
        if (!saved) {
            return ports.cancellation.isCancellationRequested() ? "cancelled" : "failed";
        }
        if (!(await mappingConsent)) {
            return "cancelled";
        }

        const imageErrors = chapter.imageErrors || 0;
        const imageCount = chapter.images?.length || 0;
        ports.log({
            code:
                imageErrors > 0
                    ? "chapter-processed-with-image-failures"
                    : imageCount > 0
                      ? "chapter-processed-with-images"
                      : "chapter-processed",
            params: {
                retry: isRetry,
                completed: progress.snapshot.completedCount,
                ...scope.position(task),
                title: task.title,
                url: task.url,
                ...(imageCount > 0 || imageErrors > 0 ? { imageCount } : {}),
                ...(imageErrors > 0 ? { imageErrors } : {})
            }
        });

        if (!ports.cancellation.isCancellationRequested()) {
            await ports.scheduler.sleepWithAbort(ports.scheduler.randomDelay(100, 199));
        }
        return ports.cancellation.isCancellationRequested() ? "cancelled" : "completed";
    }

    /**
     * 处理缓存命中、外部链接、密码章节和普通正文
     */
    async function processChapterTask(task: DownloadTask, isRetry = false): Promise<ChapterTaskResult> {
        if (ports.cancellation.isCancellationRequested()) {
            return "cancelled";
        }

        // 已恢复章节只推进现有 UI 完成数，不重复网络请求和解析
        if (!isRetry && chapters.has(task.index)) {
            progress.update({
                completedCount: progress.snapshot.completedCount + 1
            });
            ports.events.emit({ type: "chapter-restored", task });
            return "completed";
        }

        // 非站内章节保留占位内容，维持原有章节顺序和导出数量
        const isValidChapter = /\/forum\/\d+\/\d+\.html/.test(task.url) && task.url.includes("esjzone");
        if (!isValidChapter) {
            const message = `${task.url} {非站内链接}`;
            chapters.set(task.index, {
                title: task.title,
                content: message,
                txtSegment: `${task.title}\n${message}\n\n`
            });
            progress.update({
                completedCount: progress.snapshot.completedCount + 1,
                processedCount: progress.snapshot.processedCount + 1
            });
            const saved = await cache.add(task.index, chapters.get(task.index)!);
            if (!saved) {
                return ports.cancellation.isCancellationRequested() ? "cancelled" : "failed";
            }
            ports.log({
                code: "chapter-skipped-non-site",
                params: {
                    completed: progress.snapshot.completedCount,
                    ...scope.position(task),
                    title: task.title
                }
            });
            await ports.scheduler.sleepWithAbort(100);
            return ports.cancellation.isCancellationRequested() ? "cancelled" : "completed";
        }

        const html = await downloadChapterHtml(task, isRetry);
        if (!html || ports.cancellation.isCancellationRequested()) {
            if (!isRetry && !ports.cancellation.isCancellationRequested()) {
                progress.update({
                    completedCount: progress.snapshot.completedCount + 1,
                    failedCount: progress.snapshot.failedCount + 1
                });
            }
            return ports.cancellation.isCancellationRequested() ? "cancelled" : "failed";
        }
        progress.update({ fetchedCount: progress.snapshot.fetchedCount + 1 });
        if (ports.protectedChapterDetector.isProtected(html)) {
            return protectedChapters.handle(task, html, isRetry, processFetchedChapterHtml);
        }

        return processFetchedChapterHtml(task, html, isRetry);
    }
    /**
     * 并发抓取普通章节，并等待密码队列收尾
     */
    async function download(concurrency: number): Promise<void> {
        ports.log({ code: "download-started", params: { concurrency } });
        const consumer = protectedChapters.consume(processFetchedChapterHtml);
        let workerFailure: unknown;
        try {
            await runWorkerPool({
                items: scope.options.tasks.filter((task) => !chapters.has(task.index)),
                concurrency,
                isCancellationRequested: shouldStop,
                beforeClaim: mapping.beforeClaim,
                process: (task) => processChapterTask(task).then(() => undefined)
            });
        } catch (error) {
            workerFailure = error;
        } finally {
            // 普通抓取结束后仍要处理完密码队列，才能检查缺章
            protectedChapters.closeProducer();
        }
        await consumer;
        if (workerFailure) {
            throw workerFailure;
        }
    }
    /**
     * 自动补抓与手动补章共用串行重试路径
     */
    async function retry(issues: readonly ChapterIntegrityIssue[], missingOnly = false): Promise<void> {
        protectedChapters.beginRetryRound();
        progress.update({ retryPendingCount: issues.length, failedCount: issues.length });
        await runWorkerPool({
            items: issues,
            concurrency: 1,
            isCancellationRequested: shouldStop,
            beforeClaim: mapping.beforeClaim,
            process: async ({ task, reason }) => {
                ports.log({
                    code: missingOnly ? "missing-chapter-retry" : "chapter-integrity-retry",
                    params: {
                        ...scope.position(task),
                        title: task.title,
                        reason,
                        ...(reason === "image-errors"
                            ? { imageErrors: chapters.get(task.index)?.imageErrors ?? 0 }
                            : {})
                    }
                });
                const result = await processChapterTask(task, true);
                if (result === "cancelled") {
                    return;
                }
                progress.update({
                    retryPendingCount: Math.max(0, progress.snapshot.retryPendingCount - 1),
                    failedCount: Math.max(0, progress.snapshot.failedCount - (result === "completed" ? 1 : 0))
                });
                if (!ports.cancellation.isCancellationRequested()) {
                    await ports.scheduler.sleepWithAbort(300);
                }
            }
        });
        if (!ports.cancellation.isCancellationRequested()) {
            cache.assertHealthy();
            mapping.assertHealthy();
        }
    }
    /**
     * 自动补抓缺失正文和图片异常章节
     */
    async function checkIntegrity(): Promise<void> {
        ports.log({ code: "integrity-check-started" });
        const issues = scanChapterIntegrity(scope.options.tasks, chapters, scope.options.imageEnabled);
        progress.update({ retryPendingCount: issues.length, failedCount: issues.length });
        ports.log(
            issues.length
                ? { code: "integrity-check-failed", params: { count: issues.length } }
                : { code: "integrity-check-passed" }
        );
        if (!issues.length) {
            return;
        }
        await retry(issues);
        if (!ports.cancellation.isCancellationRequested()) {
            progress.update({
                retryPendingCount: 0,
                failedCount: scanChapterIntegrity(scope.options.tasks, chapters, scope.options.imageEnabled).length
            });
        }
    }
    /**
     * 仍有缺章时让用户选择补抓、占位导出或取消
     */
    async function resolveIncomplete(): Promise<void> {
        while (!ports.cancellation.isCancellationRequested()) {
            const missingTasks = scanMissingChapterTasks(scope.options.tasks, chapters);
            progress.update({ retryPendingCount: 0, failedCount: missingTasks.length });
            if (!missingTasks.length) {
                return;
            }
            if (progress.snapshot.phase === "flushing-cache") {
                progress.transition("checking-integrity");
            }
            // 自动补抓仍有缺章，才要求用户决定下一步
            const decision = await runUserDecision(
                decisions,
                ports.cancellation,
                () =>
                    ports.ui.confirmIncompleteChapters(
                        {
                            missingTasks,
                            totalChapters: scope.options.tasks.length,
                            ...(scope.selection.mode === "range"
                                ? {
                                      sourceTotalChapters: scope.selection.sourceTotalChapters,
                                      selectionMode: scope.selection.mode,
                                      taskOrderByIndex: scope.taskOrderByIndex
                                  }
                                : {})
                        },
                        ports.cancellation.signal
                    ),
                "cancel"
            );
            ports.events.emit({ type: "incomplete-chapters-decided", missingCount: missingTasks.length, decision });
            if (ports.cancellation.isCancellationRequested() || decision === "cancel") {
                if (!ports.cancellation.isCancellationRequested()) {
                    ports.cancellation.requestCancellation("flush");
                }
                return;
            }
            if (decision === "export-with-placeholders") {
                ports.log({ code: "missing-chapter-export-with-placeholders", params: { count: missingTasks.length } });
                return;
            }
            ports.log({ code: "missing-chapter-retry-started", params: { count: missingTasks.length } });
            await retry(
                missingTasks.map((task) => ({ task, reason: "missing" })),
                true
            );
            if (ports.cancellation.isCancellationRequested()) {
                return;
            }
            // 新补章节先落盘，再重新计算缺章列表
            progress.transition("flushing-cache");
            ports.log({ code: "missing-chapter-retry-saved" });
            await cache.flush();
            if (!ports.cancellation.isCancellationRequested()) {
                cache.assertHealthy();
            }
        }
    }
    return { download, checkIntegrity, resolveIncomplete };
}
