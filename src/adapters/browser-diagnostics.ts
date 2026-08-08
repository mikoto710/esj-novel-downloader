import {
    createEmptyDiagnosticStore,
    createDiagnosticSessionView,
    DiagnosticManager,
    DIAGNOSTIC_SCHEMA_VERSION,
    type DiagnosticRepository,
    type DiagnosticLogRecord,
    type DiagnosticResult,
    type DiagnosticSession,
    type DiagnosticSessionPresentation,
    type DiagnosticStore,
    type DiagnosticSessionViewStore,
    type RecordDiagnosticFailureInput,
    type RecordDiagnosticExportInput,
    type StartDiagnosticSessionInput
} from "../core/diagnostics";
import type { DownloadEventSink, DownloadLog, DownloadLogCode, DownloadOptions } from "../core/download/contracts";
import { getConcurrency, getEpubTagPageSetting } from "../core/config";
import { log, triggerDownload } from "../utils/index";
import { formatDownloadLog } from "./browser-download-messages";
import { t } from "../ui/locale";

const DIAGNOSTIC_STORAGE_KEY = "esj_diagnostic_sessions_v1";

class GmDiagnosticRepository implements DiagnosticRepository {
    // 版本或结构不兼容时回退为空存储，避免旧数据阻断诊断流程
    load(): DiagnosticStore {
        try {
            const stored = GM_getValue<DiagnosticStore | null>(DIAGNOSTIC_STORAGE_KEY, null);
            if (
                !stored ||
                stored.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION ||
                !Array.isArray(stored.active) ||
                !Array.isArray(stored.history)
            ) {
                return createEmptyDiagnosticStore();
            }
            return stored;
        } catch (error) {
            console.warn("读取诊断日志失败", error);
            return createEmptyDiagnosticStore();
        }
    }

    save(store: DiagnosticStore): void {
        try {
            GM_setValue(DIAGNOSTIC_STORAGE_KEY, store);
        } catch (error) {
            // 诊断功能不得反向中断下载、缓存或导出流程
            console.warn("保存诊断日志失败", error);
        }
    }
}

const manager = new DiagnosticManager(new GmDiagnosticRepository());
// 页面内只会有一个全本任务；lastTaskId 用于下载完成后的导出失败仍写回本页对应会话
let currentTaskId: string | null = null;
let lastTaskId: string | null = null;
const closeObserverCleanups = new Map<string, () => void>();

/**
 * 停止指定任务的 pagehide 监听，并移除该任务登记的清理回调
 */
function stopBrowserDiagnosticCloseObserver(taskId: string): void {
    const cleanup = closeObserverCleanups.get(taskId);
    closeObserverCleanups.delete(taskId);
    cleanup?.();
}

/**
 * 为诊断会话监听真实的 pagehide；bfcache 挂起不视为页面关闭，监听由任务收尾或全量清理路径移除
 */
function observeBrowserDiagnosticPageClose(taskId: string): void {
    stopBrowserDiagnosticCloseObserver(taskId);
    const onPageHide = (event: PageTransitionEvent) => {
        if (event.persisted) {
            // bfcache 挂起后页面可能返回，不能把这次离场记录为关闭
            return;
        }
        stopBrowserDiagnosticCloseObserver(taskId);
        manager.markCloseObserved(taskId);
    };
    window.addEventListener("pagehide", onPageHide);
    closeObserverCleanups.set(taskId, () => window.removeEventListener("pagehide", onPageHide));
}

function parseChromeVersion(): string {
    const match = navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/);
    return match ? `Chrome ${match[1]}` : "Chrome（版本未知）";
}

function getApplicationInfo(): StartDiagnosticSessionInput["application"] {
    const scriptVersion = GM_info?.script?.version?.trim() || "版本未知";
    const handler = GM_info?.scriptHandler?.trim() || "Tampermonkey";
    const handlerVersion = GM_info?.version?.trim();
    return {
        version: scriptVersion,
        browser: parseChromeVersion(),
        userscriptManager: handlerVersion ? `${handler} ${handlerVersion}` : handler
    };
}

/**
 * 创建浏览器侧诊断会话并固定任务启动时的应用与设置快照
 * @param options 控制是否将会话作为后续失败归属，以及是否观察页面关闭
 * @returns 已保存的活动诊断会话
 */
export function startBrowserDiagnosticSession(
    input: Omit<StartDiagnosticSessionInput, "application" | "settings"> & {
        imageEnabled: boolean;
    },
    options: { rememberForLaterFailures?: boolean; observePageClose?: boolean } = {}
): DiagnosticSession {
    currentTaskId = input.taskId;
    if (options.rememberForLaterFailures !== false) {
        lastTaskId = input.taskId;
    }
    const session = manager.start({
        ...input,
        application: getApplicationInfo(),
        settings: {
            concurrency: getConcurrency(),
            imageEnabled: input.imageEnabled,
            epubTagPageEnabled: getEpubTagPageSetting()
        }
    });
    if (options.observePageClose) {
        observeBrowserDiagnosticPageClose(input.taskId);
    }
    return session;
}

/**
 * 在下载锁建立前为预检失败创建独立短生命周期会话，并立即写入失败终态
 */
export function recordBrowserPreflightDiagnosticFailure(
    input: Omit<StartDiagnosticSessionInput, "taskId" | "application" | "settings"> & {
        imageEnabled: boolean;
        failure: RecordDiagnosticFailureInput;
    }
): DiagnosticSession {
    // 缓存预读失败发生在下载锁创建前，不能依赖正常下载任务的 taskId
    const taskId = `preflight-${input.bookId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    startBrowserDiagnosticSession({ ...input, taskId });
    manager.recordFailure(taskId, input.failure);
    finishBrowserDiagnosticSession(taskId, "failed");
    return manager.list().history.find((session) => session.taskId === taskId)!;
}

/**
 * 将全本下载选项补充到对应诊断会话，并将该任务设为当前日志归属
 */
export function updateBrowserDiagnosticSession(options: DownloadOptions): void {
    currentTaskId = options.taskId;
    manager.updateSession(options.taskId, options);
}

/**
 * 更新指定诊断会话的书名、页面地址或来源页面类型
 */
export function updateBrowserDiagnosticSessionMetadata(
    taskId: string,
    options: Partial<Pick<DownloadOptions, "bookName" | "pageUrl" | "sourcePageType">>
): void {
    manager.updateSession(taskId, options);
}

/**
 * 将全本诊断会话写入指定终态并停止该任务的页面关闭观察
 */
export function finishBrowserDiagnosticSession(taskId: string, result: Exclude<DiagnosticResult, "running">): void {
    stopBrowserDiagnosticCloseObserver(taskId);
    manager.finish(taskId, result);
    if (currentTaskId === taskId) {
        currentTaskId = null;
    }
}

/**
 * 完成单章诊断会话并将结果映射为单章阶段及计数摘要
 */
export function finishBrowserSingleChapterDiagnosticSession(
    taskId: string,
    result: Exclude<DiagnosticResult, "running">
): void {
    stopBrowserDiagnosticCloseObserver(taskId);
    const completed = result === "success" ? 1 : 0;
    manager.finish(taskId, result, {
        phase: result === "success" ? "export-ready" : result === "cancelled" ? "cancelled" : "failed",
        totalChapters: 1,
        fetchedChapters: completed,
        processedChapters: completed,
        completedChapters: completed,
        failedChapters: result === "failed" ? 1 : 0
    });
    if (currentTaskId === taskId) {
        currentTaskId = null;
    }
}

/**
 * 将失败写回诊断会话；未显式传入 taskId 时按当前任务、最后任务和最近会话依次回退
 */
export function recordBrowserDiagnosticFailure(input: RecordDiagnosticFailureInput, taskId = currentTaskId): void {
    const targetTaskId = taskId || lastTaskId || getLatestBrowserDiagnosticSession()?.taskId;
    if (targetTaskId) {
        manager.recordFailure(targetTaskId, input);
    }
}

/**
 * 将导出结果写回诊断会话；未显式传入 taskId 时沿用失败记录的任务回退顺序
 */
export function recordBrowserDiagnosticExport(input: RecordDiagnosticExportInput, taskId = currentTaskId): void {
    const targetTaskId = taskId || lastTaskId || getLatestBrowserDiagnosticSession()?.taskId;
    if (targetTaskId) {
        manager.recordExport(targetTaskId, input);
    }
}

/**
 * 将日志写入 UI 和控制台，并在存在活动会话时以最佳努力追加诊断记录
 */
export function browserDiagnosticLog(message: string | DownloadLog): void {
    // 先保持原有 UI/控制台日志，再以最佳努力写入诊断；诊断异常不得改变下载行为
    const displayMessage = typeof message === "string" ? message : formatDownloadLog(message);
    log(displayMessage);
    if (currentTaskId) {
        manager.recordLog(
            currentTaskId,
            typeof message === "string"
                ? { level: "info", message }
                : {
                      level: classifyDownloadLogLevel(message.code),
                      code: message.code,
                      ...(message.params === undefined ? {} : { params: message.params })
                  }
        );
    }
}

const ERROR_LOG_CODES = new Set<DownloadLogCode>([
    "cover-cache-write-ownership-lost",
    "chapter-mapping-font-failed",
    "protected-chapter-connection-failed",
    "protected-chapter-protocol-failed",
    "download-storage-failed",
    "cache-discard-failed"
]);

const WARNING_LOG_CODES = new Set<DownloadLogCode>([
    "cover-cache-read-failed",
    "cover-cache-write-failed",
    "restored-mapping-font-invalid",
    "cache-write-retry",
    "chapter-fetch-failed",
    "chapter-skipped-non-site",
    "protected-chapter-retry-skipped",
    "protected-chapter-redetected",
    "protected-chapter-queued",
    "protected-chapter-skipped",
    "protected-chapter-connection-retry",
    "protected-chapter-password-rejected",
    "integrity-check-failed",
    "chapter-integrity-retry",
    "missing-chapter-retry",
    "missing-chapter-export-with-placeholders",
    "missing-chapter-retry-started",
    "cancellation-cache-write-skipped-lock-lost"
]);

function classifyDownloadLogLevel(code: DownloadLogCode): DiagnosticLogRecord["level"] {
    if (ERROR_LOG_CODES.has(code)) {
        return "error";
    }
    return WARNING_LOG_CODES.has(code) ? "warning" : "info";
}

/**
 * 将结构化诊断日志按当前界面语言格式化；旧版字符串日志保持原文可读
 */
export function formatBrowserDiagnosticLog(entry: DiagnosticLogRecord): string {
    if (entry.code) {
        return formatDownloadLog({
            code: entry.code as DownloadLogCode,
            ...(entry.params === undefined ? {} : { params: entry.params })
        });
    }
    return entry.message || entry.code || "";
}

export const browserDiagnosticEvents: DownloadEventSink = {
    emit(event) {
        const taskId = currentTaskId;
        if (!taskId) {
            return;
        }
        manager.recordDownloadEvent(taskId, event);
        if (event.type === "phase-changed" && ["export-ready", "cancelled"].includes(event.current)) {
            stopBrowserDiagnosticCloseObserver(taskId);
            currentTaskId = null;
        }
        if (event.type === "download-failed") {
            stopBrowserDiagnosticCloseObserver(taskId);
            currentTaskId = null;
        }
    }
};

/**
 * 读取规范化后的活动诊断会话与历史记录
 */
export function listBrowserDiagnosticSessions(): DiagnosticStore {
    return manager.list();
}

/**
 * 读取按当前时间计算展示状态的诊断会话视图，不改写持久终态
 */
export function listBrowserDiagnosticSessionView(): DiagnosticSessionViewStore {
    return createDiagnosticSessionView(manager.list(), Date.now());
}

export function isBrowserDiagnosticSessionActive(taskId: string): boolean {
    return manager.list().active.some((session) => session.taskId === taskId);
}

export function removeBrowserDiagnosticSession(sessionId: string): void {
    manager.remove(sessionId);
}

/**
 * 停止全部页面关闭观察并清空诊断会话及后续失败归属
 */
export function clearBrowserDiagnosticSessions(): void {
    for (const cleanup of closeObserverCleanups.values()) {
        cleanup();
    }
    closeObserverCleanups.clear();
    manager.clear();
    currentTaskId = null;
    lastTaskId = null;
}

/**
 * 返回更新时间最新的 active 会话；没有 active 会话时回退到最近一条历史记录
 */
export function getLatestBrowserDiagnosticSession(): DiagnosticSession | null {
    const store = manager.list();
    return store.active.sort((a, b) => b.updatedAt - a.updatedAt)[0] || store.history[0] || null;
}

function safeFilenamePart(value: string): string {
    return (
        value
            .replace(/[\\/:*?"<>|]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60) || "book"
    );
}

/**
 * 生成安全文件名和可下载的诊断 JSON，并为结构化日志补充当前语言的可读文本
 */
export function createBrowserDiagnosticExport(session: DiagnosticSession): { filename: string; json: string } {
    const date = new Date(session.updatedAt)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    return {
        filename: `esj-diagnostic-${safeFilenamePart(session.book.title)}-${date}.json`,
        json: JSON.stringify(
            {
                session: {
                    ...session,
                    logs: session.logs.map((entry) => ({ ...entry, message: formatBrowserDiagnosticLog(entry) }))
                }
            },
            null,
            2
        )
    };
}

/**
 * 生成并触发指定诊断会话的 JSON 文件下载
 */
export function downloadBrowserDiagnosticSession(session: DiagnosticSession): void {
    const exported = createBrowserDiagnosticExport(session);
    triggerDownload(new Blob([exported.json], { type: "application/json;charset=utf-8" }), exported.filename);
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
export function formatBrowserDiagnosticSummary(
    session: DiagnosticSession,
    presentation: DiagnosticSessionPresentation = session.result
): string {
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
    const logLines = session.logs.slice(-20).map((entry) => `- [${entry.level}] ${formatBrowserDiagnosticLog(entry)}`);
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
        `ESJ Novel Downloader ${session.application.version}`,
        `${session.application.browser} / ${session.application.userscriptManager}`,
        t("diagnostics.summary.book", { title: session.book.title, bookId: session.book.bookId }),
        t("diagnostics.summary.link", { url: session.book.url }),
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
