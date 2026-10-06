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
