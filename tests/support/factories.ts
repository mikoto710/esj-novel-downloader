import type { DownloadTask } from "../../src/core/downloader";
import type {
    AppState,
    BookDownloadLock,
    BookMetadata,
    CacheMeta,
    CachedData,
    Chapter,
    ChapterImage,
    RuntimeCacheSession
} from "../../src/types";

const BASE_TIME = Date.parse("2026-01-01T00:00:00.000Z");

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

export function createChapterImage(index = 0, overrides: Partial<ChapterImage> = {}): ChapterImage {
    return {
        id: `img_0_${index}.jpg`,
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }),
        mediaType: "image/jpeg",
        ...overrides
    };
}

export function createDownloadTask(index = 0, overrides: Partial<DownloadTask> = {}): DownloadTask {
    const chapterNumber = index + 1;
    return {
        index,
        url: `https://www.esjzone.cc/forum/100/${chapterNumber}.html`,
        title: `第 ${chapterNumber} 章`,
        ...overrides
    };
}

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

export function createRuntimeCacheSession(overrides: Partial<RuntimeCacheSession> = {}): RuntimeCacheSession {
    const meta = createCacheMeta(overrides);
    return {
        ...meta,
        taskId: "task-100",
        completedCount: 0,
        cachedChapterCount: 0,
        status: "downloading",
        hasExportData: false,
        ...overrides
    };
}

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
            chapterInfo: `共 ${chapters.length} 章`,
            imageEnabled: false
        },
        ...overrides
    };
}

export interface TestAppState extends AppState {
    abortController: AbortController | null;
    activeBookLock: BookDownloadLock | null;
}

export function createTestState(overrides: Partial<TestAppState> = {}): TestAppState {
    return {
        abortFlag: false,
        originalTitle: "ESJZone Test",
        cachedData: null,
        globalChaptersMap: new Map<number, Chapter>(),
        runtimeCacheSession: null,
        abortController: new AbortController(),
        activeBookLock: null,
        ...overrides
    };
}
