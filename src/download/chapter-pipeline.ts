import type { Chapter } from "../content/model";
import type { DownloadDependencies, DownloadTask, MappingFontFailure } from "./contracts";
import type { DownloadPlan } from "./plan";
import type { DownloadProgress } from "./progress";
import type { TaskCacheWriter } from "./cache-writer";
import { createProtectedChapters, type ChapterTaskResult, type ProtectedChapterResolution } from "./protected-chapters";
import type { ChapterIntegrityIssue } from "./integrity";
import { DEFAULT_CHAPTER_RETRY_POLICY, runWithRetry } from "./retry-policy";
import { runWorkerPool } from "./worker-pool";
import { runUserDecision, type UserDecisionGate } from "./user-decision-gate";
import { MappingFontError } from "../content/mapping-font";
import { getErrorDetails } from "./errors";

type ChapterPorts = Pick<
    DownloadDependencies,
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
    chapters: Map<number, Chapter>,
    plan: DownloadPlan,
    imageEnabled: boolean,
    pageUrl: string,
    progress: DownloadProgress,
    cache: TaskCacheWriter,
    decisions: UserDecisionGate
) {
    const { concurrency } = ports;
    const protectedChapters = createProtectedChapters(ports, plan, progress, decisions);
    const CACHE_RESTORE_YIELD_INTERVAL = 25;
    let mappingConsentGranted = false;
    let mappingConsentPromise: Promise<boolean> | null = null;
    const mappedChapterIndexes = new Set<number>();
    let mappedFontBytes = 0;
    const mappingFailures = new Map<number, MappingFontFailure>();

    function getMappingFontSummary() {
        return {
            chapterCount: mappedChapterIndexes.size,
            fontBytes: mappedFontBytes
        };
    }

    function recordMappedChapter(task: DownloadTask, chapter: Chapter): boolean {
        const font = chapter.mappingFont;
        if (!font || mappedChapterIndexes.has(task.index)) {
            return false;
        }
        mappedChapterIndexes.add(task.index);
        mappedFontBytes += font.blob.size;
        ports.events.emit({ type: "mapping-font-updated", summary: getMappingFontSummary() });
        return true;
    }

    // 并发 worker 共用首次字体确认，拒绝时取消下载
    function ensureMappingConsent(task: DownloadTask, inFlightLimit: number): Promise<boolean> {
        if (mappingConsentGranted) {
            return Promise.resolve(true);
        }
        if (!mappingConsentPromise) {
            mappingConsentPromise = runUserDecision(
                decisions,
                ports.cancellation,
                () =>
                    ports.ui.confirmMappingFontDownload(
                        { task, ...getMappingFontSummary(), inFlightLimit },
                        ports.cancellation.signal
                    ),
                false
            ).then((confirmed) => {
                if (confirmed) {
                    mappingConsentGranted = true;
                } else {
                    ports.cancellation.requestCancellation();
                }
                return confirmed;
            });
        }
        return mappingConsentPromise;
    }

    function registerMappedChapter(task: DownloadTask, chapter: Chapter): Promise<boolean> {
        if (!chapter.mappingFont) {
            return Promise.resolve(true);
        }
        if (recordMappedChapter(task, chapter)) {
            ports.ui.updateMappingFontWarning(getMappingFontSummary());
        }
        return ensureMappingConsent(task, concurrency);
    }

    async function waitForMappingConsentBeforeClaim(): Promise<boolean> {
        if (mappingConsentPromise && !mappingConsentGranted) {
            return mappingConsentPromise;
        }
        return !ports.cancellation.isCancellationRequested();
    }

    /**
     * 校验本次选择的缓存，失效章节留给抓取流程补齐
     */
    async function restoreCachedChapters(): Promise<boolean> {
        const taskByIndex = new Map(plan.tasks.map((task) => [task.index, task]));
        const entries = Array.from(chapters.entries())
            .filter(([index]) => plan.indexes.has(index))
            .sort(([left], [right]) => left - right);
        const changedEntries = new Map<number, Chapter>();
        let firstMappedTask: DownloadTask | null = null;
        let invalidatedCount = 0;

        if (entries.length > 0) {
            // 分片让出执行权，避免大量缓存校验阻塞界面
            await ports.scheduler.sleepWithAbort(0);
        }

        for (const [entryIndex, [index, chapter]] of entries.entries()) {
            if (ports.cancellation.isCancellationRequested()) {
                return false;
            }
            try {
                const normalized = await ports.chapterProcessor.normalizeCached(chapter, ports.cancellation.signal);
                if (normalized.kind === "mapped") {
                    const task = taskByIndex.get(index) || {
                        index,
                        url: pageUrl,
                        title: chapter.title
                    };
                    if (recordMappedChapter(task, normalized.chapter) && !firstMappedTask) {
                        firstMappedTask = task;
                    }
                }
                if (normalized.changed) {
                    chapters.set(index, normalized.chapter);
                    changedEntries.set(index, normalized.chapter);
                }
            } catch (error) {
                if (error instanceof MappingFontError) {
                    // 只使当前章节失效，后续重新抓取
                    chapters.delete(index);
                    cache.invalidate(index);
                    invalidatedCount++;
                    ports.log({
                        code: "restored-mapping-font-invalid",
                        params: { title: chapter.title, detail: error.message }
                    });
                } else {
                    throw error;
                }
            }

            if ((entryIndex + 1) % CACHE_RESTORE_YIELD_INTERVAL === 0 && entryIndex + 1 < entries.length) {
                await ports.scheduler.sleepWithAbort(0);
                if (ports.cancellation.isCancellationRequested()) {
                    return false;
                }
            }
        }

        const restoredTasks = plan.tasks.filter((task) => chapters.has(task.index));
        if (entries.length > 0) {
            ports.log({
                code: invalidatedCount > 0 ? "cache-restored-with-invalidated" : "cache-restored",
                params: {
                    count: restoredTasks.length,
                    ...(invalidatedCount > 0 ? { invalidatedCount } : {})
                }
            });
        }
        progress.recordCacheRestored();
        for (const task of restoredTasks) {
            ports.events.emit({ type: "chapter-restored", task });
        }

        // 先汇总所有缓存字体，再统一确认一次
        if (firstMappedTask) {
            ports.ui.updateMappingFontWarning(getMappingFontSummary());
            if (!(await ensureMappingConsent(firstMappedTask, 0))) {
                return false;
            }
        }

        // 仅回写发生规范化变化的章节
        for (const [index, chapter] of changedEntries) {
            if (!(await cache.enqueue(index, chapter))) {
                return false;
            }
        }
        return !ports.cancellation.isCancellationRequested();
    }

    function throwIfMappingFontFailed(): void {
        if (mappingFailures.size === 0) {
            return;
        }
        const failures = Array.from(mappingFailures.values());
        throw new MappingFontError("font-source-invalid", "chapter-structure-invalid", { count: failures.length });
    }

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
            mappingFailures.delete(task.index);
        } catch (error) {
            if (!(error instanceof MappingFontError)) {
                throw error;
            }
            mappingFailures.set(task.index, { task, code: error.code, reason: error.reason, params: error.params });
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
                progress.recordInitialFailure();
            }
            return "failed";
        }
        if (ports.cancellation.isCancellationRequested()) {
            return "cancelled";
        }

        // 确认期间允许已完成的章节落盘，但暂停领取新任务
        const mappingConsent = registerMappedChapter(task, chapter);
        chapters.set(task.index, chapter);
        ports.events.emit({ type: "chapter-processed", task, retry: isRetry });

        progress.recordProcessed(isRetry);

        const accepted = await cache.enqueue(task.index, chapter);
        if (!accepted) {
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

    // 处理外部链接、密码章节和普通正文
    async function processChapterTask(task: DownloadTask, isRetry = false): Promise<ChapterTaskResult> {
        if (ports.cancellation.isCancellationRequested()) {
            return "cancelled";
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
            progress.recordProcessed();
            const accepted = await cache.enqueue(task.index, chapters.get(task.index)!);
            if (!accepted) {
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
                progress.recordInitialFailure();
            }
            return ports.cancellation.isCancellationRequested() ? "cancelled" : "failed";
        }
        progress.recordFetched();
        if (ports.protectedChapterDetector.isProtected(html)) {
            const resolution = await protectedChapters.handle(task, html, isRetry);
            if (resolution.kind === "deferred") {
                return "deferred";
            }
            return processProtectedChapterResult(task, resolution, isRetry);
        }

        return processFetchedChapterHtml(task, html, isRetry);
    }

    // 授权结果在本文件接回普通正文处理，读者无需反查密码模块中的正文回调
    async function processProtectedChapterResult(
        task: DownloadTask,
        resolution: ProtectedChapterResolution,
        isRetry: boolean
    ): Promise<ChapterTaskResult> {
        ports.ui.closeProtectedChapterPrompt();
        if (resolution.kind !== "unlocked") {
            return resolution.kind === "cancelled" ? "cancelled" : "failed";
        }
        const processed = await processFetchedChapterHtml(task, resolution.html, isRetry);
        if (processed === "completed") {
            ports.log({ code: "protected-chapter-unlocked", params: { ...plan.position(task), title: task.title } });
        }
        return processed;
    }

    async function consumeProtectedChapters(): Promise<void> {
        while (!ports.cancellation.isCancellationRequested()) {
            const item = await protectedChapters.take();
            if (!item) {
                return;
            }
            const resolution = await protectedChapters.resolveProtectedChapter(item);
            await processProtectedChapterResult(item.task, resolution, false);
        }
    }

    /**
     * 并发抓取普通章节，并等待密码队列收尾
     */
    async function download(): Promise<void> {
        ports.log({ code: "download-started", params: { concurrency } });
        const consumer = consumeProtectedChapters();
        let workerFailure: unknown;
        try {
            await runWorkerPool({
                items: plan.tasks.filter((task) => !chapters.has(task.index)),
                concurrency,
                isCancellationRequested: shouldStop,
                beforeClaim: waitForMappingConsentBeforeClaim,
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
        progress.recordIntegrityScan(issues.length, issues.length);
        await runWorkerPool({
            items: issues,
            concurrency: 1,
            isCancellationRequested: shouldStop,
            beforeClaim: waitForMappingConsentBeforeClaim,
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
                progress.recordRetryFinished(result === "completed");
                if (!ports.cancellation.isCancellationRequested()) {
                    await ports.scheduler.sleepWithAbort(300);
                }
            }
        });
        if (!ports.cancellation.isCancellationRequested()) {
            cache.assertHealthy();
            throwIfMappingFontFailed();
        }
    }

    return {
        restore: restoreCachedChapters,
        download,
        retry,
        get mappingFailures() {
            return Array.from(mappingFailures.values());
        },
        dispose() {
            protectedChapters.dispose();
            ports.ui.closeProtectedChapterPrompt();
        }
    };
}

export type ChapterPipeline = ReturnType<typeof createChapterPipeline>;
