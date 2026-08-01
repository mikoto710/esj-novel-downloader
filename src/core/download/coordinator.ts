import type { CacheMeta, Chapter } from "../../types";
import { ChapterCacheWriteBuffer } from "./cache-write-buffer";
import type { DownloadDependencies, DownloadOptions, DownloadSnapshot, DownloadTask } from "./contracts";
import { getChapterRetryReason } from "./integrity";
import { DownloadStateMachine } from "./state-machine";

// 单次下载会话共享的依赖、元数据和状态机，不持有任何浏览器全局对象
interface DownloadContext {
    options: DownloadOptions;
    dependencies: DownloadDependencies;
    machine: DownloadStateMachine;
    cacheMeta: CacheMeta;
    total: number;
    imageEnabled: boolean;
    cacheBuffer: ChapterCacheWriteBuffer;
}

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

// 增量保存本批脏章节，并在 writer 所有权丢失时停止旧任务
async function persistTaskCacheBatch(ctx: DownloadContext, entries: ReadonlyMap<number, Chapter>): Promise<boolean> {
    const { dependencies, options, cacheMeta } = ctx;
    dependencies.events.emit({ type: "cache-write-started", chapterCount: entries.size });
    const saved = await dependencies.cache.putBatch(options.bookId, options.taskId, entries, cacheMeta);
    dependencies.events.emit({ type: "cache-write-finished", chapterCount: entries.size, saved });
    if (saved) {
        const chapterCount = dependencies.runtime.chapters.size;
        updateSnapshot(ctx, { persistedCount: chapterCount, cachedChapterCount: chapterCount });
    } else {
        dependencies.log("下载任务已失去缓存写入权，正在停止旧任务。");
        dependencies.runtime.requestCancellation();
    }
    return saved;
}

// 按现有策略重试章节 HTML，请求实现由 ChapterFetcherPort 提供
async function downloadChapterHtml(task: DownloadTask, ctx: DownloadContext): Promise<string | null> {
    const { dependencies } = ctx;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (dependencies.runtime.isCancellationRequested()) {
            return null;
        }
        try {
            return await dependencies.chapterFetcher.fetch(task, dependencies.runtime.signal);
        } catch (error) {
            const details = getErrorDetails(error);
            if (details.name === "AbortError" || dependencies.runtime.isCancellationRequested()) {
                return null;
            }
            if (attempt === maxRetries) {
                dependencies.log(`❌ 章节获取失败 (${task.title}): ${details.message}`);
            } else {
                await dependencies.scheduler.sleepWithAbort(300 * attempt);
            }
        }
    }
    return null;
}

// 处理缓存命中、非站内链接、正常抓取和补抓四类章节路径
async function processChapterTask(task: DownloadTask, ctx: DownloadContext, isRetry = false): Promise<void> {
    const { dependencies, imageEnabled, total } = ctx;
    const { runtime } = dependencies;
    if (runtime.isCancellationRequested()) {
        return;
    }

    // 已恢复章节只推进现有 UI 完成数，不重复网络请求和解析
    if (!isRetry && runtime.chapters.has(task.index)) {
        updateSnapshot(ctx, {
            completedCount: ctx.machine.snapshot.completedCount + 1,
            cachedChapterCount: runtime.chapters.size
        });
        dependencies.events.emit({ type: "chapter-restored", task });
        updateProgress(ctx);
        return;
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
        await ctx.cacheBuffer.add(task.index, runtime.chapters.get(task.index)!);
        dependencies.log(`⚠️ 跳过 (${ctx.machine.snapshot.completedCount}/${total})：${task.title} (非站内)`);
        await dependencies.scheduler.sleepWithAbort(100);
        return;
    }

    const html = await downloadChapterHtml(task, ctx);
    if (!html || runtime.isCancellationRequested()) {
        return;
    }
    updateSnapshot(ctx, { fetchedCount: ctx.machine.snapshot.fetchedCount + 1 });

    const chapter = await dependencies.chapterProcessor.process(html, task, imageEnabled, runtime.signal);
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
            retryPendingCount: Math.max(0, ctx.machine.snapshot.retryPendingCount - 1),
            cachedChapterCount: runtime.chapters.size
        });
    }

    await ctx.cacheBuffer.add(task.index, chapter);

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
}

// 扫描缺失或图片不完整的章节，并按原顺序执行一次补抓
async function checkIntegrityAndRetry(tasks: DownloadTask[], ctx: DownloadContext): Promise<boolean> {
    const { dependencies, imageEnabled, total } = ctx;
    const { runtime } = dependencies;
    dependencies.log("正在进行章节完整性检查...");

    const missingTasks = tasks.filter(
        (task) => getChapterRetryReason(runtime.chapters.get(task.index), imageEnabled) !== null
    );
    updateSnapshot(ctx, { retryPendingCount: missingTasks.length });

    if (missingTasks.length === 0) {
        dependencies.log("✅ 完整性检查通过，无缺漏。");
        return true;
    }

    dependencies.log(`⚠ 发现 ${missingTasks.length} 个章节不完整 (缺失或含失败图片)，尝试自动补抓...`);
    for (const task of missingTasks) {
        if (runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return false;
        }

        const chapter = runtime.chapters.get(task.index);
        const retryReason = getChapterRetryReason(chapter, imageEnabled);
        const reason =
            retryReason === "missing"
                ? "缺失"
                : retryReason === "invalid-image-media-type"
                  ? "图片格式无效"
                  : `图片失败 ${chapter?.imageErrors ?? 0} 张`;
        dependencies.log(`补抓 [${task.index + 1}/${total}] (${reason})...`);
        await processChapterTask(task, ctx, true);
        await dependencies.scheduler.sleepWithAbort(300);
    }
    return !runtime.isCancellationRequested();
}

// 当前取消仍等待已开始的 IndexedDB 事务，后续取消重构会增加有界等待
async function finishCancellation(ctx: DownloadContext): Promise<void> {
    const { dependencies } = ctx;
    const { runtime } = dependencies;
    transition(ctx, "cancelling");
    const lockOwned = await dependencies.lock.owns(runtime.activeBookLock);
    const discardCache = await dependencies.lock.shouldDiscardCache(runtime.activeBookLock);
    let cacheFlushed = false;
    if (!lockOwned) {
        ctx.cacheBuffer.discard();
        dependencies.log("下载任务锁已失效，跳过缓存写入。");
    } else if (discardCache) {
        ctx.cacheBuffer.discard();
        dependencies.log("停止请求要求清理缓存，将在释放任务锁前统一处理。");
    } else {
        dependencies.log("正在写入 IndexedDB...");
        cacheFlushed = await ctx.cacheBuffer.flush();
    }
    runtime.updateCacheSession({
        completedCount: ctx.machine.snapshot.completedCount,
        cachedChapterCount: runtime.chapters.size,
        status: "cancelled",
        hasExportData: false
    });
    updateSnapshot(ctx, { cancellationRequested: true, hasExportData: false });
    transition(ctx, "cancelled");
    dependencies.log(
        !lockOwned
            ? "任务锁已失效，当前任务已停止。"
            : discardCache
              ? "任务已停止，正在清理缓存。"
              : cacheFlushed
                ? "任务已手动取消，进度已保存。"
                : "任务已手动取消，但缓存写入失败。"
    );
    await dependencies.scheduler.sleep(800);
    dependencies.ui.cleanup();
}

// 按任务索引组装现有 TXT 和章节导出数据，缺失章节使用兼容占位内容
function assembleExportChapters(ctx: DownloadContext): { text: string; chapters: Chapter[] } {
    let text = ctx.options.introTxt;
    const chapters: Chapter[] = [];
    for (let index = 0; index < ctx.total; index++) {
        const chapter = ctx.dependencies.runtime.chapters.get(index);
        if (chapter) {
            text += chapter.txtSegment;
            chapters.push(chapter);
        } else {
            text += `第 ${index + 1} 章 获取失败\n\n`;
            chapters.push({ title: `第 ${index + 1} 章 (缺失)`, content: "内容抓取失败。", txtSegment: "" });
        }
    }
    return { text, chapters };
}

/**
 * 运行一次可注入的全本下载流程
 * 不直接访问 DOM、IndexedDB、GM API 或全局 state，所有环境能力由 dependencies 提供
 */
export async function runDownload(options: DownloadOptions, dependencies: DownloadDependencies): Promise<void> {
    const total = options.tasks.length;
    const imageEnabled = dependencies.settings.isImageDownloadEnabled();
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
        write: (entries) => persistTaskCacheBatch(ctx, entries),
        schedule: dependencies.scheduler.schedule
    });
    const ctx: DownloadContext = { options, dependencies, machine, cacheMeta, total, imageEnabled, cacheBuffer };

    try {
        // 初始化 UI 和当前页会话摘要
        transition(ctx, "preparing");
        dependencies.ui.prepare();
        dependencies.runtime.startCacheSession(cacheMeta, options.taskId, dependencies.runtime.chapters.size);
        transition(ctx, "restoring-cache");
        if (dependencies.runtime.chapters.size > 0) {
            dependencies.log(`💑 已从 IndexedDB 恢复 ${dependencies.runtime.chapters.size} 章缓存`);
        }

        const coverPromise = options.coverUrl
            ? dependencies.coverFetcher.fetch(options.coverUrl, dependencies.runtime.signal)
            : Promise.resolve(null);

        // 当前 worker pool 仍沿用共享队列实现，后续再拆分调度策略
        transition(ctx, "downloading");
        const queue = [...options.tasks];
        const worker = async () => {
            while (queue.length > 0 && !dependencies.runtime.isCancellationRequested()) {
                const task = queue.shift();
                if (task) {
                    await processChapterTask(task, ctx, false);
                }
            }
        };
        const concurrency = dependencies.settings.getConcurrency();
        dependencies.log(`启动 ${concurrency} 个并发线程...`);
        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        if (dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }

        // 主抓取的脏章节落盘后才能进入完整性扫描和补抓
        transition(ctx, "flushing-cache");
        const initialFlushSaved = await cacheBuffer.flush();
        if (!initialFlushSaved || dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }
        transition(ctx, "checking-integrity");
        const integrityPassed = await checkIntegrityAndRetry(options.tasks, ctx);
        if (!integrityPassed) {
            return;
        }

        // 补抓产生的脏章节落盘后才能清理缓存并发布导出数据
        transition(ctx, "flushing-cache");
        const finalFlushSaved = await cacheBuffer.flush();
        if (!finalFlushSaved || dependencies.runtime.isCancellationRequested()) {
            await finishCancellation(ctx);
            return;
        }
        transition(ctx, "preparing-export");
        const cover = await coverPromise;
        dependencies.log("✅ 所有任务处理完毕");
        const assembled = assembleExportChapters(ctx);
        const cacheCleared = await dependencies.cache.clearForTask(options.bookId, options.taskId);
        if (!cacheCleared) {
            throw new Error("下载任务已失去缓存清理权，已停止导出");
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
        dependencies.ui.cleanup();
        dependencies.ui.showFormatChoice();
    } catch (error) {
        cacheBuffer.discard();
        if (ctx.machine.snapshot.phase !== "failed" && ctx.machine.snapshot.phase !== "cancelled") {
            transition(ctx, "failed");
        }
        dependencies.events.emit({ type: "download-failed", error, snapshot: ctx.machine.snapshot });
        throw error;
    }
}
