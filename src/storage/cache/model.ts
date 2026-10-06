import type { SourcePageType } from "../../content/model";

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
