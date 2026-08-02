import type { BookCover, CacheMeta, Chapter } from "../../types";
import { ChapterCacheWriteBuffer, type CancellationCacheFlushResult } from "./cache-write-buffer";
import type {
    DownloadCancellationOutcome,
    DownloadDependencies,
    DownloadOptions,
    DownloadSnapshot,
    DownloadTask
} from "./contracts";
import { scanChapterIntegrity, type ChapterIntegrityIssue } from "./integrity";
import { DEFAULT_CHAPTER_RETRY_POLICY, runWithRetry } from "./retry-policy";
import { DownloadStateMachine } from "./state-machine";
import { runWorkerPool } from "./worker-pool";
import { MappingFontError, normalizeChapterMappingFont } from "../mapping-font";
import {
    createStorageError,
    normalizeStorageError,
    StorageError,
    toStorageFailure,
    type StorageFailure
} from "../cache/storage-error";

// 单次下载会话共享的依赖、元数据和状态机，不持有任何浏览器全局对象
interface DownloadContext {
    options: DownloadOptions;
    dependencies: DownloadDependencies;
    machine: DownloadStateMachine;
    cacheMeta: CacheMeta;
    total: number;
    imageEnabled: boolean;
    concurrency: number;
    cacheBuffer: ChapterCacheWriteBuffer;
    cancellationPromise: Promise<void> | null;
    mappingConsentGranted: boolean;
    mappingConsentPromise: Promise<boolean> | null;
    mappedChapterIndexes: Set<number>;
    mappedFontBytes: number;
    mappingFailures: Map<number, { task: DownloadTask; message: string }>;
}

type ChapterTaskResult = "completed" | "failed" | "cancelled";

function getErrorDetails(error: unknown): { name: string; message: string } {
    return error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "Error", message: String(error) };
}

// 状态机负责产生结构化快照，UI port 只消费快照并决定如何展示
function publishSnapshot(ctx: DownloadContext, snapshot: DownloadSnapshot): void {
    ctx.dependencies.ui.update(snapshot);
}

function transition(ctx: DownloadContext, phase: DownloadSnapshot["phase"]): DownloadSnapshot {
    const snapshot = ctx.machine.transition(phase);
    publishSnapshot(ctx, snapshot);
    return snapshot;
}

function updateSnapshot(ctx: DownloadContext, progress: Partial<Omit<DownloadSnapshot, "phase">>): DownloadSnapshot {
    const snapshot = ctx.machine.update(progress);
    publishSnapshot(ctx, snapshot);
    return snapshot;
}

function updateProgress(ctx: DownloadContext): void {
    // runtime session 仍服务于现有缓存管理器，业务阶段以 DownloadSnapshot 为准
    const snapshot = ctx.machine.snapshot;
    ctx.dependencies.runtime.updateCacheSession({
        completedCount: snapshot.completedCount,
        cachedChapterCount: ctx.dependencies.runtime.chapters.size,
        status: "downloading"
    });
}

function getStorageFailure(ctx: DownloadContext): StorageFailure | null {
    return ctx.cacheBuffer.failure;
}

function throwIfStorageFailed(ctx: DownloadContext): void {
    const failure = getStorageFailure(ctx);
    if (failure) {
        throw new StorageError(failure);
    }
}

function shouldStopWorkers(ctx: DownloadContext): boolean {
    return ctx.dependencies.runtime.isCancellationRequested() || Boolean(getStorageFailure(ctx));
}

async function prepareCover(ctx: DownloadContext): Promise<BookCover | null> {
    const { dependencies, options } = ctx;
    const coverUrl = options.coverUrl;
    if (!coverUrl) {
        return null;
    }

    try {
        const cached = await dependencies.coverCache.load(options.bookId, coverUrl);
        if (cached) {
            dependencies.log("💾 已读取本地封面缓存");
            return cached;
        }
    } catch (error) {
        dependencies.log(`⚠ 封面缓存读取失败，将重新下载：${getErrorDetails(error).message}`);
    }

    if (dependencies.runtime.isCancellationRequested()) {
        return null;
    }
    const cover = await dependencies.coverFetcher.fetch(coverUrl, dependencies.runtime.signal);
    if (!cover || dependencies.runtime.isCancellationRequested()) {
        return null;
    }

    try {
        const saved = await dependencies.coverCache.put(
            options.bookId,
            options.taskId,
            coverUrl,
            cover,
            dependencies.runtime.signal
        );
        dependencies.log(saved ? "💾 封面已写入本地缓存" : "⚠ 封面缓存写入权已失效，本次继续使用内存封面");
    } catch (error) {
        dependencies.log(`⚠ 封面缓存写入失败，本次继续使用内存封面：${getErrorDetails(error).message}`);
    }
    return cover;
}

function getMappingFontSummary(ctx: DownloadContext) {
    return {
        chapterCount: ctx.mappedChapterIndexes.size,
        fontBytes: ctx.mappedFontBytes
    };
}

function recordMappedChapter(ctx: DownloadContext, task: DownloadTask, chapter: Chapter): boolean {
    const font = chapter.mappingFont;
    if (!font || ctx.mappedChapterIndexes.has(task.index)) {
        return false;
    }
    ctx.mappedChapterIndexes.add(task.index);
    ctx.mappedFontBytes += font.blob.size;
    return true;
}

// 同一任务只确认一次；并发 worker 共享该 Promise，确认期间不会继续领取新章节
function ensureMappingConsent(ctx: DownloadContext, task: DownloadTask, inFlightLimit: number): Promise<boolean> {
    if (ctx.mappingConsentGranted) {
        return Promise.resolve(true);
    }
    if (!ctx.mappingConsentPromise) {
        ctx.mappingConsentPromise = ctx.dependencies.ui
            .confirmMappingFontDownload({ task, ...getMappingFontSummary(ctx), inFlightLimit })
            .then((confirmed) => {
                if (confirmed) {
                    ctx.mappingConsentGranted = true;
                } else {
                    ctx.dependencies.runtime.requestCancellation();
                }
                return confirmed;
            });
    }
    return ctx.mappingConsentPromise;
}

function registerMappedChapter(ctx: DownloadContext, task: DownloadTask, chapter: Chapter): Promise<boolean> {
    if (!chapter.mappingFont) {
        return Promise.resolve(true);
    }
    if (recordMappedChapter(ctx, task, chapter)) {
        ctx.dependencies.ui.updateMappingFontWarning(getMappingFontSummary(ctx));
    }
    return ensureMappingConsent(ctx, task, ctx.concurrency);
}

async function waitForMappingConsentBeforeClaim(ctx: DownloadContext): Promise<boolean> {
    if (ctx.mappingConsentPromise && !ctx.mappingConsentGranted) {
        return ctx.mappingConsentPromise;
    }
    return !ctx.dependencies.runtime.isCancellationRequested();
}

// 旧缓存中的 data CSS 已包含与正文配对的完整字体，认领缓存后原位规范化并增量回存
async function normalizeRestoredChapters(ctx: DownloadContext): Promise<boolean> {
    const { dependencies, options } = ctx;
    const taskByIndex = new Map(options.tasks.map((task) => [task.index, task]));
    const entries = Array.from(dependencies.runtime.chapters.entries()).sort(([left], [right]) => left - right);
    const changedEntries = new Map<number, Chapter>();
    let firstMappedTask: DownloadTask | null = null;
    for (const [index, chapter] of entries) {
        if (dependencies.runtime.isCancellationRequested()) {
            return false;
        }
        try {
            const normalized = await normalizeChapterMappingFont(chapter, dependencies.runtime.signal);
            if (normalized.kind === "mapped") {
                const task = taskByIndex.get(index) || {
                    index,
                    url: options.pageUrl || dependencies.environment.currentUrl(),
                    title: chapter.title
                };
                if (recordMappedChapter(ctx, task, normalized.chapter) && !firstMappedTask) {
                    firstMappedTask = task;
                }
            }
            if (normalized.changed) {
                dependencies.runtime.chapters.set(index, normalized.chapter);
                changedEntries.set(index, normalized.chapter);
            }
        } catch (error) {
            if (error instanceof MappingFontError) {
                // 旧记录无法规范化时仅使该章失效，后续 worker 会重新抓取并重新验证
                dependencies.runtime.chapters.delete(index);
                dependencies.log(`⚠️ 旧缓存映射字体无效，将重新抓取 (${chapter.title}): ${error.message}`);
                continue;
            }
            throw error;
        }
    }

    const restoredTasks = options.tasks.filter((task) => dependencies.runtime.chapters.has(task.index));
    updateSnapshot(ctx, {
        restoredCount: restoredTasks.length,
        completedCount: restoredTasks.length,
        cachedChapterCount: dependencies.runtime.chapters.size
    });
    for (const task of restoredTasks) {
        dependencies.events.emit({ type: "chapter-restored", task });
    }

    if (firstMappedTask) {
        dependencies.ui.updateMappingFontWarning(getMappingFontSummary(ctx));
        if (!(await ensureMappingConsent(ctx, firstMappedTask, 0))) {
            return false;
        }
    }

    for (const [index, chapter] of changedEntries) {
        if (!(await ctx.cacheBuffer.add(index, chapter))) {
            return false;
        }
    }
    return !dependencies.runtime.isCancellationRequested();
}

// 增量保存本批脏章节，并在 writer 所有权丢失时停止旧任务
async function persistTaskCacheBatch(
    ctx: DownloadContext,
    entries: ReadonlyMap<number, Chapter>,
    signal: AbortSignal
): Promise<boolean> {
    const { dependencies, options, cacheMeta } = ctx;
    dependencies.events.emit({ type: "cache-write-started", chapterCount: entries.size });
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const saved = await dependencies.cache.putBatch(options.bookId, options.taskId, entries, cacheMeta, signal);
            if (!saved) {
                throw createStorageError("ownership-lost", "write");
            }
            dependencies.events.emit({
                type: "cache-write-finished",
                chapterCount: entries.size,
                saved: true,
                failure: null
            });
            const chapterCount = dependencies.runtime.chapters.size;
            updateSnapshot(ctx, { persistedCount: chapterCount, cachedChapterCount: chapterCount });
            return true;
        } catch (error) {
            const normalized = normalizeStorageError(error, "write");
            if (attempt === 1 && normalized.reason !== "ownership-lost" && !signal.aborted) {
                dependencies.log(`⚠️ 缓存写入失败，正在进行一次安全重试：${normalized.message}`);
                continue;
            }
            dependencies.events.emit({
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

// 按现有策略重试章节 HTML，请求实现由 ChapterFetcherPort 提供
async function downloadChapterHtml(task: DownloadTask, ctx: DownloadContext): Promise<string | null> {
    const { dependencies } = ctx;
    const result = await runWithRetry({
        policy: DEFAULT_CHAPTER_RETRY_POLICY,
        operation: () => dependencies.chapterFetcher.fetch(task, dependencies.runtime.signal),
        sleep: dependencies.scheduler.sleepWithAbort,
        isCancellationRequested: dependencies.runtime.isCancellationRequested,
        isCancellationError: (error) => getErrorDetails(error).name === "AbortError"
    });
    if (result.status === "success") {
        return result.value;
    }
    if (result.status === "failed") {
        dependencies.log(`❌ 章节获取失败 (${task.title}): ${getErrorDetails(result.error).message}`);
    }
    return null;
}

// 处理缓存命中、非站内链接、正常抓取和补抓四类章节路径
async function processChapterTask(
    task: DownloadTask,
    ctx: DownloadContext,
    isRetry = false
): Promise<ChapterTaskResult> {
    const { dependencies, imageEnabled, total } = ctx;
    const { runtime } = dependencies;
    if (runtime.isCancellationRequested()) {
        return "cancelled";
    }

    // 已恢复章节只推进现有 UI 完成数，不重复网络请求和解析
    if (!isRetry && runtime.chapters.has(task.index)) {
        updateSnapshot(ctx, {
            completedCount: ctx.machine.snapshot.completedCount + 1,
            cachedChapterCount: runtime.chapters.size
        });
        dependencies.events.emit({ type: "chapter-restored", task });
        updateProgress(ctx);
        return "completed";
    }

    // 非站内章节保留占位内容，维持原有章节顺序和导出数量
    const isValidChapter = /\/forum\/\d+\/\d+\.html/.test(task.url) && task.url.includes("esjzone");
    if (!isValidChapter) {
        const message = `${task.url} {非站内链接}`;
        runtime.chapters.set(task.index, {
            title: task.title,
            content: message,
            txtSegment: `${task.title}\n${message}\n\n`
        });
        updateSnapshot(ctx, {
            completedCount: ctx.machine.snapshot.completedCount + 1,
            processedCount: ctx.machine.snapshot.processedCount + 1,
            cachedChapterCount: runtime.chapters.size
        });
        updateProgress(ctx);
        const saved = await ctx.cacheBuffer.add(task.index, runtime.chapters.get(task.index)!);
        if (!saved) {
            return runtime.isCancellationRequested() ? "cancelled" : "failed";
        }
        dependencies.log(`⚠️ 跳过 (${ctx.machine.snapshot.completedCount}/${total})：${task.title} (非站内)`);
        await dependencies.scheduler.sleepWithAbort(100);
        return runtime.isCancellationRequested() ? "cancelled" : "completed";
    }

    const html = await downloadChapterHtml(task, ctx);
    if (!html || runtime.isCancellationRequested()) {
        if (!isRetry && !runtime.isCancellationRequested()) {
            updateSnapshot(ctx, {
                completedCount: ctx.machine.snapshot.completedCount + 1,
                failedCount: ctx.machine.snapshot.failedCount + 1
            });
            updateProgress(ctx);
        }
        return runtime.isCancellationRequested() ? "cancelled" : "failed";
    }
    updateSnapshot(ctx, { fetchedCount: ctx.machine.snapshot.fetchedCount + 1 });

    let chapter: Chapter;
    try {
        chapter = await dependencies.chapterProcessor.process(html, task, imageEnabled, runtime.signal);
        ctx.mappingFailures.delete(task.index);
    } catch (error) {
        if (!(error instanceof MappingFontError)) {
            throw error;
        }
        const message = `映射字体解析失败: ${error.message}`;
        ctx.mappingFailures.set(task.index, { task, message });
        dependencies.log(`❌ ${message} (${task.title})`);
        if (!isRetry) {
            updateSnapshot(ctx, {
                completedCount: ctx.machine.snapshot.completedCount + 1,
                failedCount: ctx.machine.snapshot.failedCount + 1
            });
            updateProgress(ctx);
        }
        return "failed";
    }
    if (runtime.isCancellationRequested()) {
        return "cancelled";
    }
    const mappingConsent = registerMappedChapter(ctx, task, chapter);
    runtime.chapters.set(task.index, chapter);
    dependencies.events.emit({ type: "chapter-processed", task, retry: isRetry });

    if (!isRetry) {
        updateSnapshot(ctx, {
            completedCount: ctx.machine.snapshot.completedCount + 1,
            processedCount: ctx.machine.snapshot.processedCount + 1,
            cachedChapterCount: runtime.chapters.size
        });
        updateProgress(ctx);
    } else {
        updateSnapshot(ctx, {
            processedCount: ctx.machine.snapshot.processedCount + 1,
            cachedChapterCount: runtime.chapters.size
        });
    }

    const saved = await ctx.cacheBuffer.add(task.index, chapter);
    if (!saved) {
        return runtime.isCancellationRequested() ? "cancelled" : "failed";
    }
    if (!(await mappingConsent)) {
        return "cancelled";
    }

    const imageErrors = chapter.imageErrors || 0;
    const imageCount = chapter.images?.length || 0;
    const prefix = isRetry ? "♻️ 补抓" : "✅ 抓取";
    if (imageErrors > 0) {
        dependencies.log(
            `${prefix} (${ctx.machine.snapshot.completedCount}/${total}): ${task.title} (${imageErrors}/${imageCount + imageErrors} 张图片获取失败)\nURL: ${task.url}`
        );
    } else if (imageCount > 0) {
        dependencies.log(
            `${prefix} (${ctx.machine.snapshot.completedCount}/${total}): ${task.title} (${imageCount} 张图片)\nURL: ${task.url}`
        );
    } else {
        dependencies.log(
            `${prefix} (${ctx.machine.snapshot.completedCount}/${total}): ${task.title}\nURL: ${task.url}`
        );
    }

    if (!runtime.isCancellationRequested()) {
        await dependencies.scheduler.sleepWithAbort(dependencies.scheduler.randomDelay(100, 199));
    }
    return runtime.isCancellationRequested() ? "cancelled" : "completed";
}

function getRetryReasonText(issue: ChapterIntegrityIssue, ctx: DownloadContext): string {
    if (issue.reason === "missing") {
        return "缺失";
    }
    if (issue.reason === "invalid-image-media-type") {
        return "图片格式无效";
    }
    return `图片失败 ${ctx.dependencies.runtime.chapters.get(issue.task.index)?.imageErrors ?? 0} 张`;
}

// 扫描缺失或图片不完整的章节，并按原顺序执行一次补抓
async function checkIntegrityAndRetry(tasks: DownloadTask[], ctx: DownloadContext): Promise<boolean> {
    const { dependencies, imageEnabled, total } = ctx;
    const { runtime } = dependencies;
    dependencies.log("正在进行章节完整性检查...");

    const issues = scanChapterIntegrity(tasks, runtime.chapters, imageEnabled);
    updateSnapshot(ctx, { retryPendingCount: issues.length, failedCount: issues.length });

    if (issues.length === 0) {
        dependencies.log("✅ 完整性检查通过，无缺漏。");
        return true;
    }

    dependencies.log(`⚠ 发现 ${issues.length} 个章节不完整 (缺失或含失败图片)，尝试自动补抓...`);
    await runWorkerPool({
        items: issues,
        concurrency: 1,
        isCancellationRequested: () => shouldStopWorkers(ctx),
        beforeClaim: () => waitForMappingConsentBeforeClaim(ctx),
        process: async (issue) => {
            dependencies.log(`补抓 [${issue.task.index + 1}/${total}] (${getRetryReasonText(issue, ctx)})...`);
            const result = await processChapterTask(issue.task, ctx, true);
            if (result === "cancelled") {
                return;
            }
            updateSnapshot(ctx, {
                retryPendingCount: Math.max(0, ctx.machine.snapshot.retryPendingCount - 1),
                failedCount:
                    result === "completed"
                        ? Math.max(0, ctx.machine.snapshot.failedCount - 1)
                        : ctx.machine.snapshot.failedCount
            });
            if (!runtime.isCancellationRequested()) {
                await dependencies.scheduler.sleepWithAbort(300);
            }
        }
    });
    if (runtime.isCancellationRequested()) {
        await finishCancellation(ctx);
        return false;
    }
    const remainingIssues = scanChapterIntegrity(tasks, runtime.chapters, imageEnabled);
    updateSnapshot(ctx, { retryPendingCount: 0, failedCount: remainingIssues.length });
    if (ctx.mappingFailures.size > 0) {
        const failures = Array.from(ctx.mappingFailures.values());
        dependencies.ui.showMappingFontFailure(failures);
        throw new MappingFontError("font-source-invalid", `${failures.length} 个章节的映射字体无法解析`);
    }
    return true;
}

// 多个退出分支共享同一次取消收尾，避免重复 flush、清理 UI 或更新终态
function finishCancellation(ctx: DownloadContext): Promise<void> {
    if (!ctx.cancellationPromise) {
        ctx.cancellationPromise = performCancellation(ctx);
    }
    return ctx.cancellationPromise;
}

async function performCancellation(ctx: DownloadContext): Promise<void> {
    const { dependencies } = ctx;
    const { runtime } = dependencies;
    updateSnapshot(ctx, { cancellationRequested: true, hasExportData: false });
    transition(ctx, "cancelling");
    const lockOwned = await dependencies.lock.owns(runtime.activeBookLock);
    const discardCache = await dependencies.lock.shouldDiscardCache(runtime.activeBookLock);
    let cacheResult: CancellationCacheFlushResult = "discarded";
    if (!lockOwned) {
        ctx.cacheBuffer.discard();
        dependencies.log("下载任务锁已失效，跳过缓存写入。");
    } else if (discardCache) {
        ctx.cacheBuffer.discard();
        dependencies.log("停止请求要求清理缓存，将在释放任务锁前统一处理。");
    } else {
        dependencies.log("正在写入 IndexedDB...");
        cacheResult = await ctx.cacheBuffer.flushForCancellation();
    }
    runtime.updateCacheSession({
        completedCount: ctx.machine.snapshot.completedCount,
        cachedChapterCount: runtime.chapters.size,
        status: "cancelled",
        hasExportData: false
    });
    const cancellationOutcome: DownloadCancellationOutcome = !lockOwned
        ? "ownership-lost"
        : discardCache
          ? "discarded"
          : cacheResult === "saved"
            ? "saved"
            : cacheResult === "timed-out"
              ? "save-timed-out"
              : "save-failed";
    const storageFailure = getStorageFailure(ctx);
    updateSnapshot(ctx, { cancellationOutcome, storageFailure });
    transition(ctx, "cancelled");
    const resultMessage = !lockOwned
        ? "任务锁已失效，当前任务已停止。"
        : discardCache
          ? "任务已停止，正在清理缓存。"
          : cacheResult === "saved"
            ? "任务已手动取消，进度已保存。"
            : cacheResult === "timed-out"
              ? "任务已停止，但进度保存超时，部分最新进度可能未保存。"
              : storageFailure
                ? `任务已手动取消，但缓存写入失败：${storageFailure.message}`
                : "任务已手动取消，但缓存写入失败。";
    dependencies.log(resultMessage);
    await dependencies.scheduler.sleep(800);
    dependencies.ui.cleanup();
}

// 按任务索引组装现有 TXT 和章节导出数据，缺失章节使用兼容占位内容
function assembleExportChapters(ctx: DownloadContext): { text: string; chapters: Chapter[] } {
    const textSegments = [ctx.options.introTxt];
    const chapters: Chapter[] = [];
    for (let index = 0; index < ctx.total; index++) {
        const chapter = ctx.dependencies.runtime.chapters.get(index);
        if (chapter) {
            textSegments.push(chapter.txtSegment);
            chapters.push(chapter);
        } else {
            textSegments.push(`第 ${index + 1} 章 获取失败\n\n`);
            chapters.push({ title: `第 ${index + 1} 章 (缺失)`, content: "内容抓取失败。", txtSegment: "" });
        }
    }
    return { text: textSegments.join(""), chapters };
}

/**
 * 运行一次可注入的全本下载流程
 * 不直接访问 DOM、IndexedDB、GM API 或全局 state，所有环境能力由 dependencies 提供
 */
export async function runDownload(options: DownloadOptions, dependencies: DownloadDependencies): Promise<void> {
    const total = options.tasks.length;
    const imageEnabled = dependencies.settings.isImageDownloadEnabled();
    const concurrency = Math.max(1, Math.floor(dependencies.settings.getConcurrency()) || 1);
    const cacheMeta: CacheMeta = {
        bookId: options.bookId,
        bookName: options.bookName,
        rawBookName: options.rawBookName || options.bookName,
        author: options.author || "未知作者",
        pageUrl: options.pageUrl || dependencies.environment.currentUrl(),
        totalChapters: total,
        sourcePageType: options.sourcePageType || "unknown",
        imageEnabled,
        updatedAt: dependencies.environment.now()
    };
    const machine = new DownloadStateMachine(total, dependencies.runtime.chapters.size, dependencies.events);
    const cacheBuffer = new ChapterCacheWriteBuffer({
        write: (entries, signal) => persistTaskCacheBatch(ctx, entries, signal),
        schedule: dependencies.scheduler.schedule,
        subscribeCancellation: dependencies.runtime.subscribeCancellation
    });
    const ctx: DownloadContext = {
        options,
        dependencies,
        machine,
        cacheMeta,
        total,
        imageEnabled,
        concurrency,
        cacheBuffer,
        cancellationPromise: null,
        mappingConsentGranted: false,
        mappingConsentPromise: null,
        mappedChapterIndexes: new Set(),
        mappedFontBytes: 0,
        mappingFailures: new Map()
    };

    try {
        // 初始化 UI 和当前页会话摘要
        transition(ctx, "preparing");
        dependencies.ui.prepare();
        dependencies.runtime.startCacheSession(cacheMeta, options.taskId, dependencies.runtime.chapters.size);
        transition(ctx, "restoring-cache");
        if (dependencies.runtime.chapters.size > 0) {
            dependencies.log(`💾 已从 IndexedDB 恢复 ${dependencies.runtime.chapters.size} 章缓存`);
        }
        if (!(await normalizeRestoredChapters(ctx))) {
            if (dependencies.runtime.isCancellationRequested()) {
                await finishCancellation(ctx);
                return;
            }
            throwIfStorageFailed(ctx);
            return;
        }

        const coverPromise = prepareCover(ctx);

        transition(ctx, "downloading");
        updateProgress(ctx);
        const remainingTasks = options.tasks.filter((task) => !dependencies.runtime.chapters.has(task.index));
        dependencies.log(`启动 ${ctx.concurrency} 个并发线程...`);
        await runWorkerPool({
            items: remainingTasks,
            concurrency: ctx.concurrency,
            isCancellationRequested: () => shouldStopWorkers(ctx),
            beforeClaim: () => waitForMappingConsentBeforeClaim(ctx),
            process: (task) => processChapterTask(task, ctx, false).then(() => undefined)
        });

        if (dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }
        throwIfStorageFailed(ctx);

        // 主抓取的脏章节落盘后才能进入完整性扫描和补抓
        transition(ctx, "flushing-cache");
        dependencies.log("主抓取完成，正在保存下载进度...");
        const initialFlushSaved = await cacheBuffer.flush();
        if (dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }
        throwIfStorageFailed(ctx);
        if (!initialFlushSaved) {
            return;
        }
        transition(ctx, "checking-integrity");
        const integrityPassed = await checkIntegrityAndRetry(options.tasks, ctx);
        if (!integrityPassed) {
            return;
        }

        // 补抓产生的脏章节落盘后才能清理缓存并发布导出数据
        transition(ctx, "flushing-cache");
        dependencies.log("完整性检查完成，正在保存下载进度...");
        const finalFlushSaved = await cacheBuffer.flush();
        if (dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }
        throwIfStorageFailed(ctx);
        if (!finalFlushSaved) {
            return;
        }
        transition(ctx, "preparing-export");
        dependencies.log("正在准备导出...");
        const cover = await coverPromise;
        if (dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }
        const assembled = assembleExportChapters(ctx);
        let cacheCleared = false;
        try {
            cacheCleared = await dependencies.cache.clearForTask(
                options.bookId,
                options.taskId,
                dependencies.runtime.signal
            );
        } catch (error) {
            throw normalizeStorageError(error, "clear");
        }
        if (dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }
        if (!cacheCleared) {
            throw createStorageError("ownership-lost", "clear");
        }
        dependencies.runtime.setExportData({
            txt: assembled.text,
            chapters: assembled.chapters,
            metadata: {
                title: options.bookName,
                author: options.author || "未知作者",
                description: options.description,
                tags: options.tags,
                coverBlob: cover?.blob || null,
                coverExt: cover?.ext || "jpg"
            },
            epubBlob: null,
            exportContext: {
                bookId: options.bookId,
                rawBookName: options.rawBookName || options.bookName,
                pageUrl: options.pageUrl || dependencies.environment.currentUrl(),
                sourcePageType: options.sourcePageType === "forum" ? "forum" : "detail",
                chapterInfo: `共 ${assembled.chapters.length} 章`,
                imageEnabled
            }
        });
        dependencies.runtime.updateCacheSession({
            completedCount: total,
            cachedChapterCount: assembled.chapters.length,
            status: "export-ready",
            hasExportData: true
        });
        updateSnapshot(ctx, {
            completedCount: total,
            cachedChapterCount: assembled.chapters.length,
            hasExportData: true
        });
        transition(ctx, "export-ready");
        dependencies.log("✅ 所有任务处理完毕");
        dependencies.ui.cleanup();
        dependencies.ui.showFormatChoice();
    } catch (error) {
        const bufferedFailure = getStorageFailure(ctx);
        const reportedError =
            error instanceof StorageError
                ? error
                : bufferedFailure
                  ? new StorageError(bufferedFailure, { cause: error })
                  : error;
        if (reportedError instanceof StorageError) {
            const storageFailure = toStorageFailure(reportedError);
            updateSnapshot(ctx, { storageFailure });
            dependencies.log(`❌ 下载进度未保存：${storageFailure.message}`);
        }
        cacheBuffer.discard();
        if (ctx.machine.snapshot.phase !== "failed" && ctx.machine.snapshot.phase !== "cancelled") {
            transition(ctx, "failed");
        }
        dependencies.events.emit({ type: "download-failed", error: reportedError, snapshot: ctx.machine.snapshot });
        throw reportedError;
    } finally {
        cacheBuffer.dispose();
    }
}
