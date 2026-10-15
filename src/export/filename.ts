/**
 * 导出格式与文件扩展名共用的约定
 */
export type DownloadFormat = "txt" | "epub" | "html";

/**
 * 自定义下载名不改书籍标题；留空沿用书名，扩展名由导出格式决定
 */
export function createBookExportFilename(title: string, format: DownloadFormat, filename?: string): string {
    const customName = filename
        ?.trim()
        .replace(/\.(?:txt|epub|html)$/i, "")
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim();
    return `${customName || title || "book"}.${format}`;
}

/**
 * 当前单章沿用书名前缀，仅清理章节标题中的文件名禁用字符
 */
export function createCurrentChapterFilename(
    bookName: string | undefined,
    title: string,
    format: "txt" | "html"
): string {
    const prefix = bookName !== undefined ? `[${bookName}] ` : "";
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").trim();
    return `${prefix}${safeTitle}.${format}`;
}
