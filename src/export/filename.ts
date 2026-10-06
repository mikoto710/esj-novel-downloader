import type { DownloadFormat } from "../types";
import type { DownloadSelectionSummary } from "../download/plan";

/**
 * 生成书籍导出文件名；只有真正的范围任务追加结构化章节后缀
 */
export function createBookExportFilename(
    title: string,
    format: DownloadFormat,
    selection?: DownloadSelectionSummary
): string {
    const base = title || "book";
    const suffix = selection?.mode === "range" ? `_第${selection.startChapter}-${selection.endChapter}章` : "";
    return `${base}${suffix}.${format}`;
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
