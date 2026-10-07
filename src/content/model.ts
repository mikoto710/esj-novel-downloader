import type { SupportedImageMediaType } from "./image-format";

/**
 * 内容采集的页面来源，随快照和缓存元信息保留
 */
export type SourcePageType = "detail" | "forum" | "single" | "unknown";

/**
 * 采集、缓存与导出共用的章节内容，映射字体须与对应正文一并保存
 */
export interface Chapter {
    title: string;
    content: string;
    txtSegment: string;
    images?: ChapterImage[];
    imageErrors?: number;
    // 字体必须与产生该映射正文的章节原子保存；仅用于临时视觉还原，不代表正文 Unicode 已恢复
    mappingFont?: ChapterMappingFont;
}

/**
 * ESJZone 章节级映射字体，不单独建立缓存记录以避免正文与字体错配
 */
export interface ChapterMappingFont {
    family: string;
    blob: Blob;
    mediaType: "font/woff2";
    sha256: string;
}

/**
 * 与正文资源 ID 对应的图片数据，媒体类型须已规范化
 */
export interface ChapterImage {
    id: string; // EPUB 内部的文件名 (如 img_0_1.jpg)
    blob: Blob;
    mediaType: SupportedImageMediaType;
}

/**
 * 书籍下载封面，全本与范围共用；仅保留当前导出链路稳定支持的 JPEG 与 PNG
 */
export interface BookCover {
    blob: Blob;
    ext: "jpg" | "png";
    mediaType: "image/jpeg" | "image/png";
}

/**
 * 格式生成共用的书籍元数据，封面允许为空
 */
export interface BookMetadata {
    title: string;
    author: string;
    description: string;
    tags: string[];
    coverBlob: Blob | null;
    coverExt: "jpg" | "png";
    uuid?: string;
}
