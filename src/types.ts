import type { DownloadSelectionSummary } from "./download/plan";
import type { Chapter, BookMetadata } from "./content/model";

// 缓存条目的数据来源
export type CacheSource = "indexeddb" | "runtime";

// 缓存条目的业务状态
export type CacheStatus = "downloading" | "cancelled" | "export-ready" | "persisted";

// 下载功能所在的页面类型
export type SourcePageType = "detail" | "forum" | "single" | "unknown";

// 支持的导出格式
export type DownloadFormat = "txt" | "epub" | "html";

// 已完成导出的下载记录
export interface ChapterSummary {
    totalCount: number;
    missingCount: number;
}

export interface DownloadHistoryItem {
    id: string;
    bookId?: string;
    bookName: string;
    author: string;
    format: DownloadFormat;
    sourcePageType: Extract<SourcePageType, "detail" | "forum" | "single">;
    chapterSummary?: ChapterSummary;
    selection?: DownloadSelectionSummary;
    // 兼容旧版下载记录，新记录改用 chapterSummary
    chapterInfo?: string;
    imageInfo?: {
        enabled: boolean;
        successCount: number;
        failureCount: number;
    };
    // 兼容旧版下载记录，新记录改用 imageInfo
    imageEnabled?: boolean;
    pageUrl: string;
    exportedAt: number;
}

// 全本下载任务锁状态
export type BookDownloadLockStatus = "preparing" | "running" | "released";

// 当前任务收到取消请求后，对尚未落盘缓存的处理方式
export type DownloadCancellationMode = "flush" | "discard";

// 跨页面的全本下载任务锁，单章导出不使用
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
    taskId: string;
    completedCount: number;
    bookChapterCount: number;
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
    meta: CacheMeta | null;
    writerTaskId?: string;
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

// 全局状态接口
export interface AppState {
    originalTitle: string;
    cachedData: CachedData | null;
    runtimeCacheSession: RuntimeCacheSession | null;
    activeDownload: {
        bookId: string;
        taskId: string;
        requestCancellation(mode?: DownloadCancellationMode): void;
    } | null;
}
