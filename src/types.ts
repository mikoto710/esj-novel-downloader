import type { DownloadSelectionSummary } from "./download/plan";
import type { Chapter, BookMetadata } from "./content/model";

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
