import {
    createEmptyDiagnosticStore,
    DiagnosticManager,
    DIAGNOSTIC_SCHEMA_VERSION,
    type DiagnosticRepository,
    type DiagnosticResult,
    type DiagnosticSession,
    type DiagnosticStore,
    type RecordDiagnosticFailureInput,
    type RecordDiagnosticExportInput,
    type StartDiagnosticSessionInput
} from "../core/diagnostics";
import type { DownloadEventSink, DownloadOptions } from "../core/download/contracts";
import { getConcurrency, getEpubTagPageSetting } from "../core/config";
import { log, triggerDownload } from "../utils/index";

const DIAGNOSTIC_STORAGE_KEY = "esj_diagnostic_sessions_v1";

class GmDiagnosticRepository implements DiagnosticRepository {
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

export function startBrowserDiagnosticSession(
    input: Omit<StartDiagnosticSessionInput, "application" | "settings"> & {
        imageEnabled: boolean;
    },
    options: { rememberForLaterFailures?: boolean } = {}
): DiagnosticSession {
    currentTaskId = input.taskId;
    if (options.rememberForLaterFailures !== false) {
        lastTaskId = input.taskId;
    }
    return manager.start({
        ...input,
        application: getApplicationInfo(),
        settings: {
            concurrency: getConcurrency(),
            imageEnabled: input.imageEnabled,
            epubTagPageEnabled: getEpubTagPageSetting()
        }
    });
}

export function recordBrowserPreflightDiagnosticFailure(
    input: Omit<StartDiagnosticSessionInput, "taskId" | "application" | "settings"> & {
        imageEnabled: boolean;
        failure: RecordDiagnosticFailureInput;
    }
): DiagnosticSession {
    // 缓存预读失败发生在下载锁创建前，使用短生命周期的独立会话保留错误弹窗所需诊断
    const taskId = `preflight-${input.bookId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    startBrowserDiagnosticSession({ ...input, taskId });
    manager.recordFailure(taskId, input.failure);
    finishBrowserDiagnosticSession(taskId, "failed");
    return manager.list().history.find((session) => session.taskId === taskId)!;
}

export function updateBrowserDiagnosticSession(options: DownloadOptions): void {
    currentTaskId = options.taskId;
    manager.updateSession(options.taskId, options);
}

export function updateBrowserDiagnosticSessionMetadata(
    taskId: string,
    options: Partial<Pick<DownloadOptions, "bookName" | "pageUrl" | "sourcePageType">>
): void {
    manager.updateSession(taskId, options);
}

export function finishBrowserDiagnosticSession(taskId: string, result: Exclude<DiagnosticResult, "running">): void {
    manager.finish(taskId, result);
    if (currentTaskId === taskId) {
        currentTaskId = null;
    }
}

export function finishBrowserSingleChapterDiagnosticSession(
    taskId: string,
    result: Exclude<DiagnosticResult, "running">
): void {
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

export function recordBrowserDiagnosticFailure(input: RecordDiagnosticFailureInput, taskId = currentTaskId): void {
    const targetTaskId = taskId || lastTaskId || getLatestBrowserDiagnosticSession()?.taskId;
    if (targetTaskId) {
        manager.recordFailure(targetTaskId, input);
    }
}

export function recordBrowserDiagnosticExport(input: RecordDiagnosticExportInput, taskId = currentTaskId): void {
    const targetTaskId = taskId || lastTaskId || getLatestBrowserDiagnosticSession()?.taskId;
    if (targetTaskId) {
        manager.recordExport(targetTaskId, input);
    }
}

export function browserDiagnosticLog(message: string): void {
    // 先保持原有 UI/控制台日志，再以最佳努力写入诊断；诊断异常不得改变下载行为
    log(message);
    if (currentTaskId) {
        manager.recordLog(currentTaskId, message);
    }
}

export const browserDiagnosticEvents: DownloadEventSink = {
    emit(event) {
        if (!currentTaskId) {
            return;
        }
        manager.recordDownloadEvent(currentTaskId, event);
        if (event.type === "phase-changed" && ["export-ready", "cancelled"].includes(event.current)) {
            currentTaskId = null;
        }
        if (event.type === "download-failed") {
            currentTaskId = null;
        }
    }
};

export function listBrowserDiagnosticSessions(): DiagnosticStore {
    return manager.list();
}

export function isBrowserDiagnosticSessionActive(taskId: string): boolean {
    return manager.list().active.some((session) => session.taskId === taskId);
}

export function removeBrowserDiagnosticSession(sessionId: string): void {
    manager.remove(sessionId);
}

export function clearBrowserDiagnosticSessions(): void {
    manager.clear();
    currentTaskId = null;
    lastTaskId = null;
}

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

export function createBrowserDiagnosticExport(session: DiagnosticSession): { filename: string; json: string } {
    const date = new Date(session.updatedAt)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    return {
        filename: `esj-diagnostic-${safeFilenamePart(session.book.title)}-${date}.json`,
        json: JSON.stringify({ session }, null, 2)
    };
}

export function downloadBrowserDiagnosticSession(session: DiagnosticSession): void {
    const exported = createBrowserDiagnosticExport(session);
    triggerDownload(new Blob([exported.json], { type: "application/json;charset=utf-8" }), exported.filename);
}

export function formatBrowserDiagnosticSummary(session: DiagnosticSession): string {
    const failureLines = session.failures.slice(-10).map((failure) => {
        const chapter = failure.chapter
            ? `；章节 ${failure.chapter.index}「${failure.chapter.title}」 ${failure.chapter.url}`
            : "";
        return `- [${failure.code}] ${failure.message}${chapter}`;
    });
    const exportLines = (session.exports || []).map((item) => {
        const format = `${item.scope === "single" ? "单章 " : ""}${item.format.toUpperCase()}`;
        if (item.outcome === "cancelled") {
            return `- ${format}：用户取消`;
        }
        if (item.outcome === "success") {
            return `- ${format}：生成成功，已触发浏览器下载`;
        }
        return item.failureStage === "generate"
            ? `- ${format}：生成失败，未触发浏览器下载`
            : `- ${format}：生成成功，浏览器下载触发失败`;
    });
    return [
        `ESJ Novel Downloader ${session.application.version}`,
        `${session.application.browser} / ${session.application.userscriptManager}`,
        `作品：${session.book.title}（${session.book.bookId}）`,
        `链接：${session.book.url}`,
        `结果：${session.result}；阶段：${session.task.phase}`,
        `章节：${session.task.completedChapters}/${session.task.totalChapters}；缓存恢复：${session.task.restoredChapters}；失败：${session.task.failedChapters}`,
        `插图：${session.settings.imageEnabled ? "开启" : "关闭"}；并发：${session.settings.concurrency}`,
        exportLines.length > 0 ? `导出记录：\n${exportLines.join("\n")}` : "导出记录：无",
        failureLines.length > 0 ? `失败摘要：\n${failureLines.join("\n")}` : "失败摘要：无"
    ].join("\n");
}
