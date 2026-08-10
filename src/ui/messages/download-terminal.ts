import type { DownloadTerminalFailure } from "../../core/download/contracts";
import type { StorageFailure } from "../../core/cache/storage-error";
import { showMessagePopup } from "../dialogs/message";
import { t } from "../locale";
import { formatStorageFailure } from "./storage-failure";

function showStorageFailure(title: string, message: string, failure: StorageFailure | null): void {
    if (!failure) {
        showMessagePopup({ tone: "error", title, message });
        return;
    }

    showMessagePopup({
        tone: "error",
        title,
        message,
        details: `${t("download.terminal.reason")}：${formatStorageFailure(failure)}\n${t("download.terminal.code")}：${failure.reason}\n${t("download.terminal.operation")}：${failure.operation}`
    });
}

/**
 * 下载弹窗清理完成后显示唯一的终态失败提示，避免页面层重复清理或覆盖消息
 */
export function showDownloadTerminalFailure(failure: DownloadTerminalFailure): void {
    if (failure.kind === "download") {
        if (failure.storageFailure) {
            showStorageFailure(
                t("download.terminal.progressNotSaved.title"),
                t("download.terminal.progressNotSaved.message"),
                failure.storageFailure
            );
            return;
        }
        showMessagePopup({
            tone: "error",
            title: t("download.terminal.failed.title"),
            message: t("download.terminal.failed.message"),
            details: [
                `${t("download.terminal.code")}：${failure.code}`,
                ...(failure.params.errorName ? [`${t("download.terminal.reason")}：${failure.params.errorName}`] : []),
                ...(failure.params.detail ? [String(failure.params.detail)] : [])
            ].join("\n")
        });
        return;
    }

    if (failure.outcome === "ownership-lost") {
        showStorageFailure(
            t("download.terminal.ownershipLost.title"),
            t("download.terminal.ownershipLost.message"),
            failure.storageFailure
        );
        return;
    }
    if (failure.outcome === "save-timed-out") {
        showStorageFailure(
            t("download.terminal.saveTimeout.title"),
            t("download.terminal.saveTimeout.message"),
            failure.storageFailure
        );
        return;
    }
    showStorageFailure(
        t("download.terminal.saveFailed.title"),
        t("download.terminal.saveFailed.message"),
        failure.storageFailure
    );
}

/**
 * 在“停止并清除”任务已完成收尾但缓存清除失败时显示明确提示
 */
export function showCacheDiscardFailure(failure: StorageFailure): void {
    showStorageFailure(
        t("download.terminal.discardFailed.title"),
        t("download.terminal.discardFailed.message"),
        failure
    );
}
