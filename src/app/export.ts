import type { ExportSnapshot } from "../export/snapshot";
import type { MappingFontSummary } from "../download/contracts";
import { buildEpub } from "../export/epub";
import { buildTxt } from "../export/txt";
import { buildBookHtml } from "../export/html";
import { createBookExportFilename } from "../export/filename";
import { getEpubTagPageSetting, getImageDownloadSetting } from "../storage/settings";
import { addDownloadHistory } from "../storage/history";
import { recordBrowserDiagnosticExport, recordBrowserDiagnosticFailure } from "../adapters/browser-diagnostics";
import { triggerDownload } from "../browser/files";
import { getExportErrorDetails } from "../ui/messages/export";

// 正文快照保持原对象，应用层独占可失效的 EPUB 派生产物
export interface CachedData extends ExportSnapshot {
    epubBlob?: Blob | null;
    epubTagPageEnabled?: boolean;
    epubRevision?: number;
}

export type ExportFormat = "txt" | "epub" | "html";
export type ExportFailureStage = "generate" | "download";
interface ExportView {
    failed(format: ExportFormat, stage: ExportFailureStage, details: string): void;
}
interface RichExportView extends ExportView {
    confirm(format: "epub" | "html", summary: MappingFontSummary): Promise<boolean>;
    generating(format: "epub" | "html"): void;
}

/**
 * 使指定原结果的派生产物失效，进行中的生成也不得写回
 */
export function invalidateCachedEpub(data: CachedData | null): void {
    if (data) {
        data.epubBlob = null;
        delete data.epubTagPageEnabled;
        data.epubRevision = (data.epubRevision || 0) + 1;
    }
}

/**
 * 汇总原结果的格式能力，TXT 与富文本共用字体约束
 */
export function getExportCapabilities(chapters: ExportSnapshot["chapters"]): {
    mappingSummary: MappingFontSummary;
    txtEnabled: boolean;
} {
    const mapped = chapters.filter((chapter) => Boolean(chapter.mappingFont));
    return {
        mappingSummary: {
            chapterCount: mapped.length,
            fontBytes: mapped.reduce((total, chapter) => total + (chapter.mappingFont?.blob.size || 0), 0)
        },
        txtEnabled: mapped.length === 0
    };
}

/**
 * 固定格式窗口展示的插图设置，优先使用原任务快照
 */
export function getExportImageSetting(data: CachedData): boolean {
    return data.exportContext?.imageEnabled ?? getImageDownloadSetting();
}

function recordFailedExport(
    data: CachedData,
    format: ExportFormat,
    stage: ExportFailureStage,
    error: unknown,
    view: ExportView
): void {
    const details = getExportErrorDetails(error);
    // 旧快照没有来源身份时，不把导出归到后来任务
    if (data.exportContext?.taskId) {
        recordBrowserDiagnosticExport(
            {
                scope: "full",
                format,
                outcome: "failed",
                generated: stage === "download",
                downloadTriggered: false,
                failureStage: stage
            },
            data.exportContext?.taskId
        );
        recordBrowserDiagnosticFailure(
            {
                scope: "export",
                stage: `${format}-${stage}`,
                code: error instanceof Error ? error.name || "export-failed" : "export-failed",
                message: details
            },
            data.exportContext?.taskId
        );
    }
    view.failed(format, stage, details);
}

/**
 * 同步导出 TXT，保留触发失败后的重试入口
 */
export function exportBookTxt(data: CachedData, view: ExportView): void {
    if (!getExportCapabilities(data.chapters).txtEnabled) {
        return;
    }
    const filename = createBookExportFilename(data.metadata.title, "txt", data.exportContext?.selection);
    let blob: Blob;
    try {
        blob = buildTxt(data.txt);
    } catch (error) {
        recordFailedExport(data, "txt", "generate", error, view);
        return;
    }
    try {
        triggerDownload(blob, filename);
        recordSuccessfulExport(data, "txt");
        void recordBookExport(data, "txt");
    } catch (error) {
        console.error(error);
        recordFailedExport(data, "txt", "download", error, view);
    }
}

/**
 * 按原结果生成或复用富文本产物，历史写入不阻塞书籍导出
 */
export async function exportBookRich(data: CachedData, format: "epub" | "html", view: RichExportView): Promise<void> {
    let stage: ExportFailureStage = "generate";
    try {
        const { mappingSummary } = getExportCapabilities(data.chapters);
        if (mappingSummary.chapterCount > 0 && !(await view.confirm(format, mappingSummary))) {
            recordCancelledExport(data, format);
            return;
        }
        const epubTagPageEnabled = format === "epub" && getEpubTagPageSetting();
        if (format === "epub" && data.epubTagPageEnabled !== epubTagPageEnabled) {
            data.epubBlob = null;
        }
        const revision = data.epubRevision || 0;
        let blob = format === "epub" ? data.epubBlob : null;
        if (!blob) {
            view.generating(format);
            blob =
                format === "epub"
                    ? await buildEpub(data.chapters, data.metadata, epubTagPageEnabled)
                    : await buildBookHtml(data.chapters, data.metadata);
            if (
                format === "epub" &&
                getEpubTagPageSetting() === epubTagPageEnabled &&
                (data.epubRevision || 0) === revision
            ) {
                // 既复核设置又复核失效代次，设置切回原值也不能恢复旧生成
                data.epubBlob = blob;
                data.epubTagPageEnabled = epubTagPageEnabled;
            }
        }
        stage = "download";
        triggerDownload(blob, createBookExportFilename(data.metadata.title, format, data.exportContext?.selection));
        recordSuccessfulExport(data, format);
        void recordBookExport(data, format);
    } catch (error) {
        console.error(error);
        recordFailedExport(data, format, stage, error, view);
    }
}

function recordSuccessfulExport(data: CachedData, format: "txt" | "epub" | "html"): void {
    if (!data.exportContext?.taskId) {
        return;
    }
    recordBrowserDiagnosticExport(
        {
            scope: "full",
            format,
            outcome: "success",
            generated: true,
            downloadTriggered: true,
            failureStage: null
        },
        data.exportContext?.taskId
    );
}

function recordCancelledExport(data: CachedData, format: "epub" | "html"): void {
    if (!data.exportContext?.taskId) {
        return;
    }
    recordBrowserDiagnosticExport(
        {
            scope: "full",
            format,
            outcome: "cancelled",
            generated: false,
            downloadTriggered: false,
            failureStage: null
        },
        data.exportContext?.taskId
    );
}

function recordBookExport(data: CachedData, format: "txt" | "epub" | "html"): Promise<void> {
    const context = data.exportContext;
    const imageSuccessCount = data.chapters.reduce((count, chapter) => count + (chapter.images?.length || 0), 0);
    const imageFailureCount = data.chapters.reduce((count, chapter) => count + (chapter.imageErrors || 0), 0);
    const imageInfo =
        format === "txt"
            ? undefined
            : {
                  enabled: context?.imageEnabled || false,
                  successCount: imageSuccessCount,
                  failureCount: imageFailureCount
              };
    return addDownloadHistory({
        ...(context?.bookId === undefined ? {} : { bookId: context.bookId }),
        bookName: context?.rawBookName || data.metadata.title || "未命名小说",
        author: data.metadata.author || "",
        format,
        sourcePageType: context?.sourcePageType || "detail",
        chapterSummary: context?.chapterSummary || {
            totalCount: data.chapters.length,
            missingCount: data.chapters.filter((chapter) => chapter.content.includes('class="esj-missing-chapter"'))
                .length
        },
        ...(context?.selection === undefined ? {} : { selection: context.selection }),
        ...(imageInfo === undefined ? {} : { imageInfo }),
        pageUrl: context?.pageUrl || location.href
    });
}
