import type { SourcePageType } from "../../content/model";

/**
 * 缓存展示和持久化共用的元信息
 */
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

/**
 * 持久缓存列表条目，仅含摘要与写入者标识，不含章节内容或 Blob
 */
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
