import type { Chapter } from "../../types";
import { escapeXml } from "../../utils/text";
import type { DownloadTask } from "./contracts";

function normalizeChapterUrl(value: string): string {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch {
        return "";
    }
}

/**
 * 创建只用于本次导出的缺章占位；调用方不得将其写回章节缓存
 */
export function createMissingChapterPlaceholder(task: DownloadTask): Chapter {
    const title = task.title || `第 ${task.index + 1} 章`;
    const safeTitle = escapeXml(title);
    const chapterUrl = normalizeChapterUrl(task.url);
    const safeUrl = escapeXml(chapterUrl);
    const link = chapterUrl ? `<p>原始链接：<a href="${safeUrl}">${safeUrl}</a></p>` : "<p>原始链接：不可用</p>";
    return {
        title,
        content: `<section class="esj-missing-chapter"><p><strong>[章节缺失]</strong></p><p>该章节在自动补抓后仍未能获取，导出文件中仅保留此占位说明。</p><p>章节：${safeTitle}</p>${link}</section>`,
        txtSegment: `${title}\n\n[章节缺失]\n该章节在自动补抓后仍未能获取，导出文件中仅保留此占位说明。\n原始链接：${chapterUrl || "不可用"}\n\n`
    };
}
