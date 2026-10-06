import type { DownloadTask } from "../../src/download/contracts";
import type { CachedData } from "../../src/export/snapshot";
import type { BookDownloadLock } from "../../src/storage/book-lock";
import type { CacheMeta } from "../../src/storage/cache/model";
import type { BookMetadata, Chapter, ChapterImage } from "../../src/content/model";

const BASE_TIME = Date.parse("2026-01-01T00:00:00.000Z");

/**
 * 创建章节测试数据
 */
export function createChapter(index = 0, overrides: Partial<Chapter> = {}): Chapter {
    const chapterNumber = index + 1;
    return {
        title: `第 ${chapterNumber} 章`,
        content: `<p>第 ${chapterNumber} 章正文</p>`,
        txtSegment: `第 ${chapterNumber} 章\n\n第 ${chapterNumber} 章正文\n\n`,
        images: [],
        imageErrors: 0,
        ...overrides
    };
}

/**
 * 创建章节图片测试数据
 */
export function createChapterImage(index = 0, overrides: Partial<ChapterImage> = {}): ChapterImage {
    return {
        id: `img_0_${index}.jpg`,
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }),
        mediaType: "image/jpeg",
        ...overrides
    };
}

/**
 * 创建下载任务测试数据
 */
export function createDownloadTask(index = 0, overrides: Partial<DownloadTask> = {}): DownloadTask {
    const chapterNumber = index + 1;
    return {
        index,
        url: `https://www.esjzone.cc/forum/100/${chapterNumber}.html`,
        title: `第 ${chapterNumber} 章`,
        ...overrides
    };
}

/**
 * 创建缓存元信息测试数据
 */
export function createCacheMeta(overrides: Partial<CacheMeta> = {}): CacheMeta {
    return {
        bookId: "100",
        bookName: "测试小说",
        rawBookName: "测试小说",
        author: "测试作者",
        pageUrl: "https://www.esjzone.cc/detail/100.html",
        totalChapters: 3,
        sourcePageType: "detail",
        imageEnabled: false,
        updatedAt: BASE_TIME,
        ...overrides
    };
}

/**
 * 创建书籍元数据测试数据
 */
export function createBookMetadata(overrides: Partial<BookMetadata> = {}): BookMetadata {
    return {
        title: "测试小说",
        author: "测试作者",
        description: "测试简介",
        tags: ["奇幻"],
        coverBlob: null,
        coverExt: "jpg",
        ...overrides
    };
}

/**
 * 创建下载锁测试数据
 */
export function createBookLock(overrides: Partial<BookDownloadLock> = {}): BookDownloadLock {
    return {
        bookId: "100",
        bookName: "测试小说",
        taskId: "task-100",
        presenceKey: "esj_download_lock_presence_task-100",
        sourcePageType: "detail",
        status: "preparing",
        startedAt: BASE_TIME,
        heartbeatAt: BASE_TIME,
        ...overrides
    };
}

/**
 * 创建可导出缓存测试数据
 */
export function createCachedData(overrides: Partial<CachedData> = {}): CachedData {
    const chapters = overrides.chapters ?? [createChapter()];
    return {
        txt: chapters.map((chapter) => chapter.txtSegment).join(""),
        chapters,
        metadata: createBookMetadata(),
        epubBlob: null,
        exportContext: {
            bookId: "100",
            rawBookName: "测试小说",
            pageUrl: "https://www.esjzone.cc/detail/100.html",
            sourcePageType: "detail",
            chapterSummary: { totalCount: chapters.length, missingCount: 0 },
            imageEnabled: false
        },
        ...overrides
    };
}
