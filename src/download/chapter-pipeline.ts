import type { Chapter } from "../content/model";
import type { DownloadDependencies, DownloadTask } from "./contracts";
import type { DownloadPlan } from "./plan";
import type { DownloadProgress } from "./progress";
import type { TaskCacheWriter } from "./cache-writer";
import { createMappedChapters } from "./mapped-chapters";
import { createProtectedChapters, type ChapterTaskResult } from "./protected-chapters";
import type { ChapterIntegrityIssue } from "./integrity";
import { DEFAULT_CHAPTER_RETRY_POLICY, runWithRetry } from "./retry-policy";
import { runWorkerPool } from "./worker-pool";
import type { UserDecisionGate } from "./user-decision-gate";
import { MappingFontError } from "../content/mapping-font";
import { getErrorDetails } from "./errors";

type ChapterPorts = Pick<
    DownloadDependencies,
    | "chapters"
    | "concurrency"
    | "cancellation"
    | "chapterFetcher"
    | "chapterProcessor"
    | "protectedChapterDetector"
    | "protectedChapterAuth"
    | "scheduler"
    | "log"
    | "events"
> & {
    ui: Pick<
        DownloadDependencies["ui"],
        | "confirmMappingFontDownload"
        | "updateMappingFontWarning"
        | "promptProtectedChapterPassword"
        | "closeProtectedChapterPrompt"
    >;
};

/**
 * 恢复、正常抓取和指定章节重试共用正文处理路径
 */
export function createChapterPipeline(
    ports: ChapterPorts,
    plan: DownloadPlan,
    imageEnabled: boolean,
    pageUrl: string,
    progress: DownloadProgress,
    cache: TaskCacheWriter,
    decisions: UserDecisionGate
) {
    const { chapters, concurrency } = ports;
    const mapping = createMappedChapters(ports, plan, pageUrl, progress, cache, decisions);
    const protectedChapters = createProtectedChapters(ports, plan, progress, decisions);
    const shouldStop = () => ports.cancellation.isCancellationRequested() || Boolean(cache.failure);
    // 按既有重试策略获取正文，普通失败交给后续完整性检查
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
                    ...plan.position(task),
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
                    ...plan.position(task),
                    title: task.title,
                    errorName: details.name,
                    detail: details.message
                },
                retry: isRetry
            });
        }
        return null;
    }

    // 处理已获取正文并提交缓存缓冲，随后等待字体确认
    async function processFetchedChapterHtml(
        task: DownloadTask,
        html: string,
        isRetry: boolean
    ): Promise<ChapterTaskResult> {
        let chapter: Chapter;
        try {
            chapter = await ports.chapterProcessor.process(html, task, imageEnabled, ports.cancellation.signal);
            mapping.clearFailure(task.index);
        } catch (error) {
            if (!(error instanceof MappingFontError)) {
                throw error;
            }
            mapping.recordFailure(task, error);
            ports.log({
                code: "chapter-mapping-font-failed",
                params: {
                    ...plan.position(task),
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
                    ...plan.position(task),
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
                ...plan.position(task),
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

    // 处理缓存命中、外部链接、密码章节和普通正文
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
                    ...plan.position(task),
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
    async function download(): Promise<void> {
        ports.log({ code: "download-started", params: { concurrency } });
        const consumer = protectedChapters.consume(processFetchedChapterHtml);
        let workerFailure: unknown;
        try {
            await runWorkerPool({
                items: plan.tasks.filter((task) => !chapters.has(task.index)),
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
     * 串行重试调用方选定的章节问题，保存和再扫描仍由调用方负责
     */
    async function retry(issues: readonly ChapterIntegrityIssue[], missingOnly = false): Promise<void> {
        // missingOnly 只区分缺章轮次日志，不筛选重试对象或改变输出范围
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
                        ...plan.position(task),
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
    return {
        restore: mapping.restore,
        download,
        retry,
        get mappingFailures() {
            return mapping.failures;
        },
        dispose: () => protectedChapters.dispose()
    };
}

export type ChapterPipeline = ReturnType<typeof createChapterPipeline>;
