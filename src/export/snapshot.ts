import type { ChapterSummary, SourcePageType } from "../types";
import type { BookCover, Chapter, BookMetadata } from "../content/model";
import type { DownloadOptions, DownloadTask } from "../download/contracts";
import type { DownloadPlan, DownloadSelectionSummary } from "../download/plan";
import { escapeXml } from "./text";
import { assembleBookTxt } from "./txt";

// 导出数据结构
export interface CachedData {
    txt: string;
    chapters: Chapter[];
    metadata: BookMetadata;
    epubBlob: Blob | null;
    // 派生产物的设置键，正文和导出归属不随此设置改变
    epubTagPageEnabled?: boolean;
    exportContext?: {
        bookId: string;
        taskId?: string;
        rawBookName?: string;
        pageUrl: string;
        sourcePageType: Extract<SourcePageType, "detail" | "forum">;
        chapterSummary?: ChapterSummary;
        selection?: DownloadSelectionSummary;
        // 兼容旧版运行时导出数据
        chapterInfo?: string;
        imageEnabled: boolean;
    };
}

function normalizeChapterUrl(value: string): string {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch {
        return "";
    }
}

/**
 * 创建只用于本次导出的缺章占位；调用方不得将其写回章节缓存
 */
export function createMissingChapterPlaceholder(task: DownloadTask): Chapter {
    const title = task.title || `第 ${task.index + 1} 章`;
    const safeTitle = escapeXml(title);
    const chapterUrl = normalizeChapterUrl(task.url);
    const safeUrl = escapeXml(chapterUrl);
    const link = chapterUrl ? `<p>原始链接：<a href="${safeUrl}">${safeUrl}</a></p>` : "<p>原始链接：不可用</p>";
    return {
        title,
        content: `<section class="esj-missing-chapter"><p><strong>[章节缺失]</strong></p><p>该章节在自动补抓后仍未能获取，导出文件中仅保留此占位说明。</p><p>章节：${safeTitle}</p>${link}</section>`,
        txtSegment: `${title}\n\n[章节缺失]\n该章节在自动补抓后仍未能获取，导出文件中仅保留此占位说明。\n原始链接：${chapterUrl || "不可用"}\n\n`
    };
}

function assembleExportChapters(tasks: readonly DownloadTask[], source: ReadonlyMap<number, Chapter>): Chapter[] {
    const chapters: Chapter[] = [];
    for (const task of tasks) {
        const chapter = source.get(task.index);
        if (chapter) {
            chapters.push(chapter);
        } else {
            const placeholder = createMissingChapterPlaceholder(task);
            chapters.push(placeholder);
        }
    }
    return chapters;
}

/**
 * 缺章占位只进入导出快照，不回写章节缓存
 */
export function createExportData(
    options: DownloadOptions,
    plan: DownloadPlan,
    pageUrl: string,
    chapters: ReadonlyMap<number, Chapter>,
    cover: BookCover | null,
    missingCount: number
): CachedData {
    const assembled = assembleExportChapters(plan.tasks, chapters);
    return {
        txt: assembleBookTxt(options.introTxt, assembled),
        chapters: assembled,
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
            taskId: options.taskId,
            rawBookName: options.rawBookName || options.bookName,
            pageUrl,
            sourcePageType: options.sourcePageType === "forum" ? "forum" : "detail",
            chapterSummary: {
                totalCount: assembled.length,
                missingCount: missingCount
            },
            selection: plan.summary,
            imageEnabled: options.imageEnabled
        }
    };
}
