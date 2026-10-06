import type { DiagnosticLogRecord, DiagnosticSession, DiagnosticSessionPresentation } from "../../diagnostics/manager";
import type { DownloadLogCode } from "../../download/contracts";
import { formatDownloadLog } from "./download-log";
import { t } from "../locale";

/**
 * 将结构化诊断日志按当前界面语言格式化；旧版字符串日志保持原文可读
 */
export function formatDiagnosticLog(entry: DiagnosticLogRecord): string {
    if (entry.code) {
        return formatDownloadLog({
            code: entry.code as DownloadLogCode,
            ...(entry.params === undefined ? {} : { params: entry.params })
        });
    }
    return entry.message || entry.code || "";
}

export function formatDiagnosticBookTitle(session: DiagnosticSession): string {
    return session.book.title || t("diagnostics.summary.unknownBook");
}

function formatDiagnosticBrowser(session: DiagnosticSession): string {
    return session.application.browserVersionUnknown
        ? t("diagnostics.summary.browserVersionUnknown", { browser: session.application.browser })
        : session.application.browser;
}

function formatPresentation(presentation: DiagnosticSessionPresentation): string {
    if (presentation === "closed-unconfirmed") {
        return t("diagnostics.summary.closed");
    }
    if (presentation === "superseded") {
        return t("diagnostics.summary.superseded");
    }
    if (presentation === "interrupted") {
        return t("diagnostics.summary.interrupted");
    }
    return presentation;
}

function formatDiagnosticFailureMessage(failure: DiagnosticSession["failures"][number]): string {
    const keys: Partial<Record<string, Parameters<typeof t>[0]>> = {
        "chapter-content-missing": "single.bodyMissing.message",
        "detail-chapter-list-missing": "page.structureChanged",
        "book-detail-chapters-missing": "page.chaptersMissing.message",
        "chapter-list-missing": "page.chaptersMissing.message",
        "ownership-lost": "page.lockLost",
        "invalid-image-url": "diagnostics.failure.invalidImageUrl",
        "image-format-unrecognized": "diagnostics.failure.imageFormatUnrecognized",
        "image-processing-failed": "diagnostics.failure.imageProcessingFailed",
        "image-request-failed": "diagnostics.failure.imageRequestFailed"
    };
    const key = keys[failure.code];
    return key ? t(key) : failure.message;
}

/**
 * 生成用户可见的诊断摘要，最多保留最近 10 条失败，并包含密码章节统计和导出结果
 */
export function formatDiagnosticSummary(
    session: DiagnosticSession,
    presentation: DiagnosticSessionPresentation = session.result
): string {
    const applicationVersion = session.application.version || t("diagnostics.summary.versionUnknown");
    const bookTitle = formatDiagnosticBookTitle(session);
    const failureLines = session.failures.slice(-10).map((failure) => {
        const chapter = failure.chapter
            ? t("diagnostics.summary.chapterFailure", {
                  index: failure.chapter.index,
                  title: failure.chapter.title,
                  url: failure.chapter.url
              })
            : "";
        const imageCount =
            failure.imageFailureCount === undefined
                ? ""
                : t("diagnostics.summary.imageFailure", { count: failure.imageFailureCount });
        return `- [${failure.code}] ${formatDiagnosticFailureMessage(failure)}${imageCount}${chapter}`;
    });
    const logLines = session.logs.slice(-20).map((entry) => `- [${entry.level}] ${formatDiagnosticLog(entry)}`);
    const exportLines = (session.exports || []).map((item) => {
        const format = `${item.scope === "single" ? t("diagnostics.summary.singlePrefix") : ""}${item.format.toUpperCase()}`;
        if (item.outcome === "cancelled") {
            return t("diagnostics.summary.exportCancelled", { format });
        }
        if (item.outcome === "success") {
            return t("diagnostics.summary.exportSuccess", { format });
        }
        return item.failureStage === "generate"
            ? t("diagnostics.summary.generateFailed", { format })
            : t("diagnostics.summary.downloadFailed", { format });
    });
    const presentationLine =
        presentation === session.result
            ? null
            : t("diagnostics.summary.presentation", {
                  presentation: formatPresentation(presentation),
                  result: session.result
              });
    return [
        `ESJ Novel Downloader ${applicationVersion}`,
        `${formatDiagnosticBrowser(session)} / ${session.application.userscriptManager}`,
        t("diagnostics.summary.book", { title: bookTitle, bookId: session.book.bookId }),
        t("diagnostics.summary.link", { url: session.book.url }),
        ...(session.selection?.mode === "range"
            ? [
                  t("diagnostics.summary.range", {
                      start: session.selection.startChapter,
                      end: session.selection.endChapter,
                      count: session.task.totalChapters,
                      sourceTotal: session.selection.sourceTotalChapters
                  })
              ]
            : []),
        ...(presentationLine ? [presentationLine] : []),
        t("diagnostics.summary.result", { result: session.result, phase: session.task.phase }),
        t("diagnostics.summary.chapters", {
            completed: session.task.completedChapters,
            total: session.task.totalChapters,
            restored: session.task.restoredChapters,
            failed: session.task.failedChapters
        }),
        t("diagnostics.summary.protected", {
            detected: session.task.protectedDetectedChapters,
            pending: session.task.protectedPendingChapters,
            resolved: session.task.protectedResolvedChapters,
            skipped: session.task.protectedSkippedChapters
        }),
        t("diagnostics.summary.images", {
            enabled: t(session.settings.imageEnabled ? "diagnostics.summary.enabled" : "diagnostics.summary.disabled"),
            concurrency: session.settings.concurrency
        }),
        t("diagnostics.summary.exports", {
            records: exportLines.length > 0 ? `\n${exportLines.join("\n")}` : t("diagnostics.summary.none")
        }),
        t("diagnostics.summary.logs", {
            records: logLines.length > 0 ? `\n${logLines.join("\n")}` : t("diagnostics.summary.none")
        }),
        t("diagnostics.summary.failures", {
            records: failureLines.length > 0 ? `\n${failureLines.join("\n")}` : t("diagnostics.summary.none")
        })
    ].join("\n");
}
