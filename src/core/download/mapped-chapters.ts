import type { Chapter } from "../../content/model";
import type { DownloadDependencies, DownloadTask, MappingFontFailure } from "./contracts";
import type { DownloadPlan } from "../../download/plan";
import type { DownloadProgress } from "./download-progress";
import type { TaskCacheWriter } from "./task-cache-writer";
import { MappingFontError } from "../../content/mapping-font";
import { runUserDecision, UserDecisionGate } from "./user-decision-gate";

type MappingPorts = Pick<DownloadDependencies, "chapters" | "concurrency" | "cancellation" | "events" | "log"> & {
    ui: Pick<DownloadDependencies["ui"], "confirmMappingFontDownload" | "updateMappingFontWarning">;
    scheduler: Pick<DownloadDependencies["scheduler"], "sleepWithAbort">;
    chapterProcessor: Pick<DownloadDependencies["chapterProcessor"], "normalizeCached">;
};
const CACHE_RESTORE_YIELD_INTERVAL = 25;

/**
 * 字体摘要、失败记录和首次确认都归本任务所有，并发章节共用同一次确认
 */
export function createMappedChapters(
    ports: MappingPorts,
    plan: DownloadPlan,
    pageUrl: string,
    progress: DownloadProgress,
    cache: TaskCacheWriter,
    decisions: UserDecisionGate
) {
    const { chapters, concurrency } = ports;
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

    /**
     * 并发 worker 共用首次字体确认，拒绝时取消下载
     */
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
     * 校验范围内缓存，失效章节留给抓取流程补齐
     */
    async function normalizeRestoredChapters(): Promise<boolean> {
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
        progress.update({
            restoredCount: restoredTasks.length,
            completedCount: restoredTasks.length,
            persistedCount: restoredTasks.length
        });
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
            if (!(await cache.add(index, chapter))) {
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
    return {
        restore: normalizeRestoredChapters,
        register: registerMappedChapter,
        beforeClaim: waitForMappingConsentBeforeClaim,
        assertHealthy: throwIfMappingFontFailed,
        clearFailure: (index: number) => mappingFailures.delete(index),
        recordFailure: (task: DownloadTask, error: MappingFontError) =>
            mappingFailures.set(task.index, { task, code: error.code, reason: error.reason, params: error.params }),
        get failures() {
            return Array.from(mappingFailures.values());
        }
    };
}
export type MappedChapters = ReturnType<typeof createMappedChapters>;
