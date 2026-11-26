import { hasInvalidImageMediaTypes } from "../content/image-format";
import type { Chapter } from "../content/model";
import type { DownloadTask } from "./contracts";

/**
 * 章节需要补抓的原因
 */
export type ChapterRetryReason = "missing" | "image-errors" | "invalid-image-media-type";

/**
 * 完整性扫描发现的待补抓章节
 */
export interface ChapterIntegrityIssue {
    task: DownloadTask;
    reason: ChapterRetryReason;
}

// 只依赖完整性检查所需字段，避免把 Chapter 的存储结构固化到判定函数中
interface ChapterIntegrityData {
    images?: readonly { mediaType: string }[];
    imageErrors?: number;
}

/**
 * 判断章节补抓原因，关闭插图时不检查图片故障或媒体类型
 */
export function getChapterRetryReason(
    chapter: ChapterIntegrityData | undefined,
    imageDownloadEnabled: boolean
): ChapterRetryReason | null {
    if (!chapter) {
        return "missing";
    }
    if (!imageDownloadEnabled) {
        return null;
    }
    if ((chapter.imageErrors ?? 0) > 0) {
        return "image-errors";
    }
    if (hasInvalidImageMediaTypes(chapter.images)) {
        return "invalid-image-media-type";
    }
    return null;
}

/**
 * 按任务顺序扫描当前章节状态，不复制或重新序列化章节正文
 */
export function scanChapterIntegrity(
    tasks: readonly DownloadTask[],
    chapters: ReadonlyMap<number, Chapter>,
    imageDownloadEnabled: boolean
): ChapterIntegrityIssue[] {
    const issues: ChapterIntegrityIssue[] = [];
    for (const task of tasks) {
        const reason = getChapterRetryReason(chapters.get(task.index), imageDownloadEnabled);
        if (reason) {
            issues.push({ task, reason });
        }
    }
    return issues;
}

/**
 * 返回尚无章节记录的任务，图片异常不进入缺正文决策
 */
export function scanMissingChapterTasks(
    tasks: readonly DownloadTask[],
    chapters: ReadonlyMap<number, Chapter>
): DownloadTask[] {
    return tasks.filter((task) => !chapters.has(task.index));
}
