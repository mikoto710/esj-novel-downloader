// 章节结构
export interface Chapter {
    title: string;
    content: string;
    txtSegment: string;
}

// 书籍元数据
export interface BookMetadata {
    title: string;
    author: string;
    coverBlob: Blob | null;
    coverExt: 'jpg' | 'png';
    uuid?: string;
}

// 导出的数据结构
export interface CachedData {
    txt: string;
    chapters: Chapter[];
    metadata: BookMetadata;
    epubBlob: Blob | null;
}

// 全局状态接口
export interface AppState {
    abortFlag: boolean;
    originalTitle: string;
    cachedData: CachedData | null;
    globalChaptersMap: Map<number, Chapter>;
}