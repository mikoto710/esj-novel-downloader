import type { CacheMeta } from "./storage/cache/model";
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

// 当前任务收到取消请求后，对尚未落盘缓存的处理方式
export type DownloadCancellationMode = "flush" | "discard";

// 当前页运行中的会话缓存摘要
export interface RuntimeCacheSession extends CacheMeta {
    taskId: string;
    completedCount: number;
    bookChapterCount: number;
    status: CacheStatus;
    hasExportData: boolean;
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
