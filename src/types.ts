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
    id: string;         // EPUB 内部的文件名 (如 img_0_1.jpg)
    blob: Blob;
    mediaType: string;
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