import type { DownloadCancellationPort, DownloadSnapshot, DownloadUiPort } from "../download/contracts";
import type { DownloadCancellationMode } from "../types";
import { isCurrentDownload } from "../app/page-session";
import {
    closeProtectedChapterPrompt,
    confirmMappingFontDownload,
    confirmIncompleteChapters,
    createDownloadPopup,
    promptProtectedChapterPassword,
    showMappingFontFailure,
    updateMappingFontWarning
} from "./popups";
import { updateTrayText } from "./tray";
import { fullCleanup } from "../utils/dom";
import { showDownloadTerminalFailure } from "./messages/download-terminal";
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
 * 进度显示和语言订阅只跟随本次任务
 */
export function createDownloadView(task: {
    taskId: string;
    originalTitle: string;
    cancellation: DownloadCancellationPort & { readonly mode: DownloadCancellationMode };
}): DownloadUiPort {
    const { originalTitle, cancellation } = task;
    const isCurrent = () => isCurrentDownload(task.taskId);
    let lastDownloadSnapshot: DownloadSnapshot | null = null;
    let activeDownloadMode: "all" | "range" = "all";
    let cleaned = false;
    let prepared = false;

    // 下载核心只发布快照，所有标题、进度条、托盘和弹窗更新在此落到 DOM
    const ui: DownloadUiPort = {
        prepare(selection) {
            if (!isCurrent()) {
                return;
            }
            activeDownloadMode = selection.mode;
            if (!prepared || !document.querySelector("#esj-popup")) {
                createDownloadPopup(selection.mode, cancellation.requestCancellation, originalTitle);
                prepared = true;
            }
        },
        update(snapshot) {
            if (!isCurrent()) {
                return;
            }
            lastDownloadSnapshot = snapshot;
            if (snapshot.phase === "cancelling" || snapshot.phase === "cancelled") {
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
                return;
            }
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
            const status = phaseStatus[snapshot.phase];
            if (status) {
                updateDownloadStatus(status, originalTitle);
                return;
            }
            if (
                snapshot.phase !== "downloading" ||
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
                          activeDownloadMode === "range"
                              ? "download.status.runningRangeProtected"
                              : "download.status.runningProtected",
                          { ready: count, total, pending }
                      )
                    : t(activeDownloadMode === "range" ? "download.status.runningRange" : "download.status.running", {
                          ready: count,
                          total
                      });
            const progressEl = document.querySelector("#esj-progress") as HTMLElement | null;
            updateDownloadStatus(downloadStatus, originalTitle);
            document.title = `[${count}/${total}${pending > 0 ? t("download.status.protectedTitle", { pending }) : ""}] ${originalTitle}`;
            if (progressEl) {
                progressEl.style.width = (count / total) * 100 + "%";
            }
        },
        confirmMappingFontDownload,
        confirmIncompleteChapters,
        promptProtectedChapterPassword,
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
        showMappingFontFailure(failures) {
            if (isCurrent()) {
                showMappingFontFailure(failures);
            }
        },
        showTerminalFailure(failure) {
            if (isCurrent()) {
                showDownloadTerminalFailure(failure);
            }
        },
        cleanup() {
            if (cleaned) {
                return;
            }
            cleaned = true;
            unsubscribeLocale();
            if (isCurrent()) {
                fullCleanup(originalTitle);
            }
        }
    };

    const unsubscribeLocale = subscribeInterfaceLocaleChange(() => {
        if (isCurrent() && lastDownloadSnapshot && document.querySelector("#esj-popup")) {
            ui.update(lastDownloadSnapshot);
        }
    });
    return ui;
}
