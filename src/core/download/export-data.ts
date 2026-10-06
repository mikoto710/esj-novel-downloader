import type { CachedData } from "../../types";
import type { BookCover, Chapter } from "../../content/model";
import type { DownloadDependencies, DownloadOptions, DownloadTask } from "../../download/contracts";
import type { DownloadPlan } from "../../download/plan";
import { createMissingChapterPlaceholder } from "./incomplete-chapters";
import { getErrorDetails } from "../../download/errors";

type CoverPorts = Pick<DownloadDependencies, "coverCache" | "coverFetcher" | "cancellation" | "log">;
/**
 * 优先复用封面缓存，封面缺失不阻断正文导出
 */
export async function prepareCover(options: DownloadOptions, ports: CoverPorts): Promise<BookCover | null> {
    const coverUrl = options.coverUrl;
    if (!coverUrl) {
        return null;
    }

    try {
        const cached = await ports.coverCache.load(options.bookId, coverUrl);
        if (cached) {
            ports.log({ code: "cover-cache-hit" });
            return cached;
        }
    } catch (error) {
        ports.log({ code: "cover-cache-read-failed", params: getErrorDetails(error) });
    }

    if (ports.cancellation.isCancellationRequested()) {
        return null;
    }
    const cover = await ports.coverFetcher.fetch(coverUrl, ports.cancellation.signal);
    if (!cover || ports.cancellation.isCancellationRequested()) {
        return null;
    }

    try {
        const saved = await ports.coverCache.put(
            options.bookId,
            options.taskId,
            coverUrl,
            cover,
            ports.cancellation.signal
        );
        ports.log({
            code: saved ? "cover-cache-saved" : "cover-cache-write-ownership-lost"
        });
    } catch (error) {
        ports.log({ code: "cover-cache-write-failed", params: getErrorDetails(error) });
    }
    return cover;
}

function assembleExportChapters(
    options: Pick<DownloadOptions, "introTxt">,
    tasks: readonly DownloadTask[],
    source: ReadonlyMap<number, Chapter>
): { text: string; chapters: Chapter[] } {
    const textSegments = [options.introTxt];
    const chapters: Chapter[] = [];
    for (const task of tasks) {
        const chapter = source.get(task.index);
        if (chapter) {
            textSegments.push(chapter.txtSegment);
            chapters.push(chapter);
        } else {
            const placeholder = createMissingChapterPlaceholder(task);
            textSegments.push(placeholder.txtSegment);
            chapters.push(placeholder);
        }
    }
    return { text: textSegments.join(""), chapters };
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
    const assembled = assembleExportChapters(options, plan.tasks, chapters);
    return {
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
            taskId: options.taskId,
            rawBookName: options.rawBookName || options.bookName,
            pageUrl,
            sourcePageType: options.sourcePageType === "forum" ? "forum" : "detail",
            chapterSummary: {
                totalCount: assembled.chapters.length,
                missingCount: missingCount
            },
            selection: plan.summary,
            imageEnabled: options.imageEnabled
        }
    };
}
