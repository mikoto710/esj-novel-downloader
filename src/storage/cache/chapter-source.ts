import type { DownloadTask } from "../../download/contracts";
import { parseOfficialChapterUrl } from "../../site/routes";

export type ChapterCacheSources = ReadonlyMap<number, string | undefined>;

function chapterCacheSource(url: string, origin: string): string | undefined {
    const official = parseOfficialChapterUrl(url);
    if (official?.origin === origin) {
        return `esj:${official.bookId}/${official.chapterId}`;
    }

    try {
        const target = new URL(url);
        return target.protocol === "https:" || target.protocol === "http:" ? target.href : undefined;
    } catch {
        return undefined;
    }
}

/**
 * 为当前目录的位置计算站内章标识或站外占位链接目标
 */
export function createChapterCacheSources(tasks: readonly DownloadTask[], origin: string): ChapterCacheSources {
    return new Map(tasks.map(({ index, url }) => [index, chapterCacheSource(url, origin)]));
}
