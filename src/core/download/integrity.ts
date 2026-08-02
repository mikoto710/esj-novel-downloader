import { hasInvalidImageMediaTypes } from "../../utils/image-format";
import type { Chapter } from "../../types";
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
 * 判断章节是否需要补抓
 * 关闭图片下载时只要求章节存在，不检查图片错误和媒体类型
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
 * 只返回正文仍未进入运行时章节表的任务；图片失败不属于 D-03 缺章决策范围
 */
export function scanMissingChapterTasks(
    tasks: readonly DownloadTask[],
    chapters: ReadonlyMap<number, Chapter>
): DownloadTask[] {
    return tasks.filter((task) => !chapters.has(task.index));
}
