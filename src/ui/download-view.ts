import type { DownloadCancellationPort, DownloadSnapshot, DownloadUiPort } from "../download/contracts";
import type { DownloadSelection } from "../download/plan";
import { isCurrentDownload } from "../app/page-session";
import {
    closeProtectedChapterPrompt,
    confirmMappingFontDownload,
    confirmIncompleteChapters,
    createDownloadPopup,
    promptProtectedChapterPassword,
    updateMappingFontWarning
} from "./popups";
import { updateTrayText } from "./tray";
import { fullCleanup } from "./dom";
import { subscribeInterfaceLocaleChange, t } from "./locale";

function updateDownloadStatus(status: string, originalTitle: string): void {
    const titleEl = document.querySelector("#esj-title") as HTMLElement | null;
    if (titleEl) {
        titleEl.textContent = "📘 " + status;
    }
    document.title = `[${status}] ${originalTitle}`;
    updateTrayText(status);
}

/**
 * 应用持有任务窗口生命周期，核心只接收 DownloadUiPort 中的业务交互
 */
export interface DownloadView extends DownloadUiPort {
    prepare(selection: DownloadSelection): void;
    cleanup(): void;
}

/**
 * 进度显示和语言订阅只跟随本次任务
 */
export function createDownloadView(task: {
    taskId: string;
    originalTitle: string;
    cancellation: DownloadCancellationPort;
}): DownloadView {
    const { originalTitle, cancellation } = task;
    const isCurrent = () => isCurrentDownload(task.taskId);
    let lastDownloadSnapshot: DownloadSnapshot | null = null;
    let activeDownloadMode: "all" | "selected" = "all";
    let cleaned = false;
    let prepared = false;

    function prepare(selection: DownloadSelection): void {
        if (!isCurrent()) {
            return;
        }
        activeDownloadMode = selection.mode;
        if (!prepared || !document.querySelector("#esj-popup")) {
            createDownloadPopup(selection.mode, cancellation.requestCancellation, originalTitle);
            prepared = true;
        }
    }

    // 取消状态保留页面标题与进度，只更新弹窗和托盘
    function updateCancellationStatus(snapshot: DownloadSnapshot): void {
        const cancelled = snapshot.phase === "cancelled";
        const status = t(cancelled ? "download.status.stopped" : "download.status.stopping");
        const titleEl = document.querySelector("#esj-title") as HTMLElement | null;
        const cancelButton = document.querySelector("#esj-cancel") as HTMLButtonElement | null;
        if (titleEl) {
            titleEl.textContent = "📘 " + status;
        }
        if (cancelButton) {
            cancelButton.disabled = true;
            cancelButton.textContent = cancelled
                ? t("download.action.stopped")
                : cancellation.mode === "discard"
                  ? t("download.action.stopping")
                  : t("download.action.saving");
            cancelButton.style.backgroundColor = "#999";
        }
        updateTrayText(status);
    }

    function getPhaseStatus(snapshot: DownloadSnapshot): string | undefined {
        const phaseStatus: Partial<Record<DownloadSnapshot["phase"], string>> = {
            preparing: t("download.status.initializing"),
            "restoring-cache":
                snapshot.readyChapterCount > 0
                    ? t("download.status.validatingCache", { count: snapshot.readyChapterCount })
                    : t("download.status.preparingCache"),
            "flushing-cache": t("download.status.savingProgress", {
                ready: snapshot.readyChapterCount,
                total: snapshot.scheduledCount
            }),
            "checking-integrity": t("download.status.checkingIntegrity", {
                ready: snapshot.readyChapterCount,
                total: snapshot.scheduledCount
            }),
            "preparing-export": t("download.status.preparingExport", {
                ready: snapshot.readyChapterCount,
                total: snapshot.scheduledCount
            }),
            "export-ready": t("download.status.exportReady", {
                ready: snapshot.readyChapterCount,
                total: snapshot.scheduledCount
            })
        };
        return phaseStatus[snapshot.phase];
    }

    function updateRunningStatus(snapshot: DownloadSnapshot): void {
        if (
            snapshot.cancellationRequested ||
            (snapshot.readyChapterCount === 0 &&
                snapshot.protectedPendingCount === 0 &&
                snapshot.protectedDetectedCount === 0)
        ) {
            return;
        }
        const { readyChapterCount: count, scheduledCount: total, protectedPendingCount: pending } = snapshot;
        const downloadStatus =
            pending > 0
                ? t(
                      activeDownloadMode === "selected"
                          ? "download.status.runningRangeProtected"
                          : "download.status.runningProtected",
                      { ready: count, total, pending }
                  )
                : t(activeDownloadMode === "selected" ? "download.status.runningRange" : "download.status.running", {
                      ready: count,
                      total
                  });
        const progressEl = document.querySelector("#esj-progress") as HTMLElement | null;
        updateDownloadStatus(downloadStatus, originalTitle);
        document.title = `[${count}/${total}${pending > 0 ? t("download.status.protectedTitle", { pending }) : ""}] ${originalTitle}`;
        if (progressEl) {
            progressEl.style.width = (count / total) * 100 + "%";
        }
    }

    // 归属检查先于快照保存与渲染，语言切换也通过同一入口重放最新快照
    function update(snapshot: DownloadSnapshot): void {
        if (!isCurrent()) {
            return;
        }
        lastDownloadSnapshot = snapshot;
        if (snapshot.phase === "cancelling" || snapshot.phase === "cancelled") {
            updateCancellationStatus(snapshot);
            return;
        }
        const status = getPhaseStatus(snapshot);
        if (status) {
            updateDownloadStatus(status, originalTitle);
            return;
        }
        if (snapshot.phase === "downloading") {
            updateRunningStatus(snapshot);
        }
    }

    function cleanup(): void {
        if (cleaned) {
            return;
        }
        cleaned = true;
        unsubscribeLocale();
        if (isCurrent()) {
            fullCleanup(originalTitle);
        }
    }

    const ui: DownloadView = {
        prepare,
        update,
        confirmMappingFontDownload,
        confirmIncompleteChapters,
        promptProtectedChapterPassword(prompt, signal) {
            return promptProtectedChapterPassword(prompt, signal, () => cancellation.requestCancellation("flush"));
        },
        closeProtectedChapterPrompt: () => {
            if (isCurrent()) {
                closeProtectedChapterPrompt();
            }
        },
        updateMappingFontWarning(summary) {
            if (isCurrent()) {
                updateMappingFontWarning(summary);
            }
        },
        cleanup
    };

    const unsubscribeLocale = subscribeInterfaceLocaleChange(() => {
        if (isCurrent() && lastDownloadSnapshot && document.querySelector("#esj-popup")) {
            ui.update(lastDownloadSnapshot);
        }
    });
    return ui;
}
