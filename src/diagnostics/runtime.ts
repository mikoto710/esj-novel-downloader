import {
    createDiagnosticSessionView,
    DiagnosticManager,
    classifyDownloadLogLevel,
    type DiagnosticResult,
    type DiagnosticSession,
    type DiagnosticStore,
    type DiagnosticSessionViewStore,
    type RecordDiagnosticFailureInput,
    type RecordDiagnosticExportInput,
    type StartDiagnosticSessionInput
} from "./manager";
import type { DownloadEvent, DownloadEventSink, DownloadLog, DownloadOptions } from "../download/contracts";
import { GmDiagnosticRepository } from "../storage/diagnostics";
import { getConcurrency, getEpubTagPageSetting } from "../storage/settings";
import { log } from "../ui/log-view";
import { formatDownloadLog } from "../ui/messages/download-log";

const manager = new DiagnosticManager(new GmDiagnosticRepository());
// currentTaskId 记录默认日志归属；lastTaskId 为任务结束后未指定身份的失败与导出提供回退
let currentTaskId: string | null = null;
let lastTaskId: string | null = null;
const closeObserverCleanups = new Map<string, () => void>();

// 停止指定任务的 pagehide 监听，并移除该任务登记的清理回调
function stopBrowserDiagnosticCloseObserver(taskId: string): void {
    const cleanup = closeObserverCleanups.get(taskId);
    closeObserverCleanups.delete(taskId);
    cleanup?.();
}

// 为诊断会话监听真实的 pagehide；bfcache 挂起不视为页面关闭，监听由任务收尾或全量清理路径移除
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

function getChromeInfo(): Pick<StartDiagnosticSessionInput["application"], "browser" | "browserVersionUnknown"> {
    const match = navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/);
    return match ? { browser: `Chrome ${match[1]}` } : { browser: "Chrome", browserVersionUnknown: true };
}

function getApplicationInfo(): StartDiagnosticSessionInput["application"] {
    const scriptVersion = GM_info?.script?.version?.trim() || "";
    const handler = GM_info?.scriptHandler?.trim() || "Tampermonkey";
    const handlerVersion = GM_info?.version?.trim();
    return {
        version: scriptVersion,
        ...getChromeInfo(),
        userscriptManager: handlerVersion ? `${handler} ${handlerVersion}` : handler
    };
}

/**
 * 固定任务诊断快照，options 控制默认回写归属和页面关闭观察，诊断不可用时返回 undefined
 */
export function startBrowserDiagnosticSession(
    input: Omit<StartDiagnosticSessionInput, "application" | "settings"> & {
        imageEnabled: boolean;
    },
    options: { rememberForLaterFailures?: boolean; observePageClose?: boolean } = {}
): DiagnosticSession | undefined {
    currentTaskId = input.taskId;
    if (options.rememberForLaterFailures !== false) {
        lastTaskId = input.taskId;
    }
    try {
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
    } catch (error) {
        // 设置快照也可能读取失败；诊断不可用不能反向阻断预检、下载或导出
        console.warn("初始化诊断日志失败", error);
        return undefined;
    }
}

/**
 * 在下载锁建立前为预检失败创建独立短生命周期会话，并立即写入失败终态
 */
export function recordBrowserPreflightDiagnosticFailure(
    input: Omit<StartDiagnosticSessionInput, "taskId" | "application" | "settings"> & {
        imageEnabled: boolean;
        failure: RecordDiagnosticFailureInput;
    }
): DiagnosticSession | undefined {
    // 缓存预读失败发生在下载锁创建前，不能依赖正常下载任务的 taskId
    const taskId = `preflight-${input.bookId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!startBrowserDiagnosticSession({ ...input, taskId })) {
        return undefined;
    }
    manager.recordFailure(taskId, input.failure);
    finishBrowserDiagnosticSession(taskId, "failed");
    return manager.list().history.find((session) => session.taskId === taskId);
}

/**
 * 使用 options.taskId 更新书籍诊断会话，并将 browserDiagnosticLog 的默认归属切换到该任务
 */
export function updateBrowserDiagnosticSession(options: DownloadOptions): void {
    currentTaskId = options.taskId;
    manager.updateSession(options.taskId, options);
}

/**
 * 更新 taskId 标识的诊断会话书名、页面地址或来源页面类型
 */
export function updateBrowserDiagnosticSessionMetadata(
    taskId: string,
    options: Partial<Pick<DownloadOptions, "bookName" | "pageUrl" | "sourcePageType">>
): void {
    manager.updateSession(taskId, options);
}

/**
 * 将 taskId 标识的书籍诊断会话写入 result 终态并停止页面关闭观察
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
 * 将失败写回 taskId 标识的诊断会话；未传 taskId 时依次选择日志归属任务、导出回写任务和更新时间最新的会话
 */
export function recordBrowserDiagnosticFailure(input: RecordDiagnosticFailureInput, taskId = currentTaskId): void {
    const targetTaskId = taskId || lastTaskId || getLatestBrowserDiagnosticSession()?.taskId;
    if (targetTaskId) {
        manager.recordFailure(targetTaskId, input);
    }
}

/**
 * 将导出结果写回 taskId 标识的诊断会话；未传 taskId 时使用与失败记录相同的会话选择规则
 */
export function recordBrowserDiagnosticExport(input: RecordDiagnosticExportInput, taskId = currentTaskId): void {
    const targetTaskId = taskId || lastTaskId || getLatestBrowserDiagnosticSession()?.taskId;
    if (targetTaskId) {
        manager.recordExport(targetTaskId, input);
    }
}

/**
 * 按 display 决定界面与控制台输出，并向 taskId 对应的活动会话追加诊断日志
 */
export function browserDiagnosticLog(message: string | DownloadLog, taskId = currentTaskId, display = true): void {
    // 先保持原有 UI/控制台日志，再以最佳努力写入诊断；诊断异常不得改变下载行为
    const displayMessage = typeof message === "string" ? message : formatDownloadLog(message);
    if (display) {
        log(displayMessage);
    }
    if (taskId) {
        manager.recordLog(
            taskId,
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

/**
 * 将下载事件写回固定任务，终态不影响其他任务的观察
 */
export function recordBrowserDownloadEvent(taskId: string, event: DownloadEvent): void {
    manager.recordDownloadEvent(taskId, event);
    if (
        (event.type === "phase-changed" && ["export-ready", "cancelled"].includes(event.current)) ||
        event.type === "download-failed"
    ) {
        stopBrowserDiagnosticCloseObserver(taskId);
        if (currentTaskId === taskId) {
            currentTaskId = null;
        }
    }
}

export const browserDiagnosticEvents: DownloadEventSink = {
    emit(event) {
        if (currentTaskId) {
            recordBrowserDownloadEvent(currentTaskId, event);
        }
    }
};

/**
 * 读取经过兼容修复、保留期限和容量约束处理的活动诊断会话与历史记录
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
 * 停止全部页面关闭观察，并清空诊断存储及无 taskId 记录使用的默认会话归属
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
