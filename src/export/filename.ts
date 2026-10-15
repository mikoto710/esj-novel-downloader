import { normalizeChapterSelectionSummary, type StoredDownloadSelectionSummary } from "../download/plan";

/**
 * 导出格式与文件扩展名共用的约定
 */
export type DownloadFormat = "txt" | "epub" | "html";

/**
 * 生成书籍导出文件名；只有真正的范围任务追加结构化章节后缀
 */
export function createBookExportFilename(
    title: string,
    format: DownloadFormat,
    selection?: StoredDownloadSelectionSummary
): string {
    const base = title || "book";
    const summary = normalizeChapterSelectionSummary(selection);
    const suffix =
        summary?.mode === "selected"
            ? summary.ranges.length === 1
                ? `_第${summary.ranges[0].startChapter}-${summary.ranges[0].endChapter}章`
                : `_自选${summary.selectedCount}章`
            : selection !== undefined && !summary
              ? "_自选"
              : "";
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
