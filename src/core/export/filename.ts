import type { DownloadFormat, DownloadSelectionSummary } from "../../types";

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
