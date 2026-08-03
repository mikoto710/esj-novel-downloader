import type { DownloadTerminalFailure } from "../core/download/contracts";
import type { StorageFailure } from "../core/cache/storage-error";
import { showMessagePopup } from "./message-popup";

function showStorageFailure(title: string, message: string, failure: StorageFailure | null): void {
    if (!failure) {
        showMessagePopup({ tone: "error", title, message });
        return;
    }

    showMessagePopup({
        tone: "error",
        title,
        message,
        details: `原因：${failure.message}\n代码：${failure.reason}\n操作：${failure.operation}`
    });
}

/**
 * 下载弹窗清理完成后显示唯一的终态失败提示，避免页面层重复清理或覆盖消息。
 */
export function showDownloadTerminalFailure(failure: DownloadTerminalFailure): void {
    if (failure.kind === "download") {
        if (failure.storageFailure) {
            showStorageFailure(
                "下载进度未保存",
                "下载任务已停止，本次新增进度可能未完整保存。请检查浏览器存储后重试。",
                failure.storageFailure
            );
            return;
        }
        showMessagePopup({
            tone: "error",
            title: "下载任务失败",
            message: "下载过程中发生异常，任务已停止。请重试；若问题持续，可打开诊断日志协助排查。",
            details: failure.message
        });
        return;
    }

    if (failure.outcome === "ownership-lost") {
        showStorageFailure(
            "任务已在其他页面接管",
            "当前页面已停止下载，且没有继续写入或清理缓存，以免覆盖其他页面的任务。",
            failure.storageFailure
        );
        return;
    }
    if (failure.outcome === "save-timed-out") {
        showStorageFailure(
            "进度保存超时",
            "任务已停止，但部分最新进度可能尚未保存。下次下载会从最后一次成功写入的缓存继续。",
            failure.storageFailure
        );
        return;
    }
    showStorageFailure(
        "进度保存失败",
        "任务已停止，但本次取消时未能确认进度已保存。下次下载会从最后一次成功写入的缓存继续。",
        failure.storageFailure
    );
}

/** 停止并清除已完成任务收尾，但缓存未能清除时保留明确提示。 */
export function showCacheDiscardFailure(failure: StorageFailure): void {
    showStorageFailure(
        "缓存清理失败",
        "任务已经停止，但原有下载缓存可能仍然保留。可稍后在缓存管理中重新清理。",
        failure
    );
}
