// 章节结构
export interface Chapter {
    title: string;
    content: string;
    txtSegment: string;
    images?: ChapterImage[];
    imageErrors?: number;
}

// 章节图片结构
export interface ChapterImage {
    id: string; // EPUB 内部的文件名 (如 img_0_1.jpg)
    blob: Blob;
    mediaType: string;
}

// 书籍元数据
export interface BookMetadata {
    title: string;
    author: string;
    description: string;
    tags: string[];
    coverBlob: Blob | null;
    coverExt: "jpg" | "png";
    uuid?: string;
}

export type CacheSource = "indexeddb" | "runtime";

export type CacheStatus = "downloading" | "cancelled" | "export-ready" | "persisted";

export type SourcePageType = "detail" | "forum" | "single" | "unknown";

export type DownloadFormat = "txt" | "epub" | "html";

export interface DownloadHistoryItem {
    id: string;
    bookId?: string;
    bookName: string;
    author: string;
    format: DownloadFormat;
    sourcePageType: Extract<SourcePageType, "detail" | "forum" | "single">;
    chapterInfo: string;
    imageInfo?: {
        enabled: boolean;
        successCount: number;
        failureCount: number;
    };
    // 兼容旧版下载记录；新记录改用 imageInfo。
    imageEnabled?: boolean;
    pageUrl: string;
    exportedAt: number;
}

export type BookDownloadLockStatus = "preparing" | "running" | "released";

// 跨页面的全本下载任务锁；单章导出不使用。
export interface BookDownloadLock {
    bookId: string;
    bookName?: string;
    taskId: string;
    presenceKey?: string;
    sourcePageType: Extract<SourcePageType, "detail" | "forum">;
    status: BookDownloadLockStatus;
    startedAt: number;
    heartbeatAt: number;
    releasedAt?: number;
    cancelRequestedAt?: number;
    discardCacheOnCancel?: boolean;
    discardCacheCompletedAt?: number;
}

// 缓存展示和持久化共用的元信息
export interface CacheMeta {
    bookId: string;
    bookName: string;
    rawBookName?: string;
    author: string;
    pageUrl: string;
    totalChapters: number;
    sourcePageType: SourcePageType;
    imageEnabled: boolean;
    updatedAt: number;
}

// 当前页运行中的会话缓存摘要
export interface RuntimeCacheSession extends CacheMeta {
    completedCount: number;
    cachedChapterCount: number;
    status: CacheStatus;
    hasExportData: boolean;
}

// IndexedDB 持久缓存条目
export interface PersistentCacheEntry {
    key: string;
    bookId: string;
    updatedAt: number;
    chapterCount: number;
    totalChapters: number | null;
    map: Map<number, Chapter>;
    meta: CacheMeta | null;
    isLegacy: boolean;
}

// 缓存管理弹窗中的统一条目视图
export interface CacheListItem {
    bookId: string;
    bookName: string;
    rawBookName?: string;
    author: string;
    pageUrl: string;
    totalChapters: number | null;
    progressCount: number;
    persistentChapterCount: number;
    runtimeChapterCount: number;
    runtimeCompletedCount: number;
    updatedAt: number;
    sourcePageType: SourcePageType;
    imageEnabled: boolean | null;
    sources: CacheSource[];
    status: CacheStatus;
    hasExportData: boolean;
    isLegacy: boolean;
    activeTask: boolean;
}

// 导出数据结构
export interface CachedData {
    txt: string;
    chapters: Chapter[];
    metadata: BookMetadata;
    epubBlob: Blob | null;
    exportContext?: {
        bookId: string;
        rawBookName?: string;
        pageUrl: string;
        sourcePageType: Extract<SourcePageType, "detail" | "forum">;
        chapterInfo: string;
        imageEnabled: boolean;
    };
}

// 全局状态接口
export interface AppState {
    abortFlag: boolean;
    originalTitle: string;
    cachedData: CachedData | null;
    globalChaptersMap: Map<number, Chapter>;
    runtimeCacheSession: RuntimeCacheSession | null;
}
