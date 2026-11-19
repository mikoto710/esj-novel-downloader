import type { MappingFontDetection, MappingFontFailure, MappingFontSummary } from "../../download/contracts";
import { el } from "../dom";
import { showMessagePopup } from "./message";
import { createConfirmationPopup, showDecisionDialog } from "./common";
import { t } from "../locale";
import { formatMappingFontError } from "../messages/mapping-font";

function formatMappingFontBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * 在下载进度弹窗中持续显示映射字体限制
 */
export function updateMappingFontWarning(summary: MappingFontSummary): void {
    const popup = document.querySelector("#esj-popup");
    if (!popup) {
        return;
    }
    let warning = popup.querySelector("#esj-mapping-warning") as HTMLElement | null;

    // 警告放在日志前方，重复检测只更新同一提示区
    if (!warning) {
        warning = el("div", {
            id: "esj-mapping-warning",
            style: "margin:0 12px 8px;padding:10px 12px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:6px;font-size:13px;line-height:1.6;"
        });
        popup.querySelector("#esj-log")?.before(warning);
    }
    warning.textContent = t("mapping.warning", {
        count: summary.chapterCount,
        bytes: formatMappingFontBytes(summary.fontBytes)
    });
}

/**
 * 首次检测到映射正文后要求用户明确同意，关闭弹窗等同停止下载
 */
export function confirmMappingFontDownload(detection: MappingFontDetection, signal?: AbortSignal): Promise<boolean> {
    return showDecisionDialog({ dismissed: false, signal, focus: "#esj-mapping-continue" }, (finish) => {
        return createConfirmationPopup(finish, {
            id: "esj-mapping-confirm",
            title: t("mapping.detected.title"),
            body: [
                el("div", { style: "font-weight:bold;margin-bottom:8px;" }, [detection.task.title]),
                t("mapping.detected.message"),
                el("div", { style: "margin-top:8px;color:#8a5a00;font-size:13px;" }, [
                    t("mapping.detected.summary", {
                        count: detection.chapterCount,
                        bytes: formatMappingFontBytes(detection.fontBytes)
                    })
                ]),
                el(
                    "div",
                    {
                        id: "esj-mapping-inflight-warning",
                        style: "margin-top:10px;padding:8px 10px;border:1px solid #f0c36d;background:#fff8e5;color:#7a5200;border-radius:5px;font-size:13px;"
                    },
                    [
                        detection.inFlightLimit > 0
                            ? t("mapping.detected.inflight", { count: detection.inFlightLimit })
                            : t("mapping.detected.paused")
                    ]
                )
            ],
            cancel: { id: "esj-mapping-stop", text: t("mapping.stop") },
            confirm: { id: "esj-mapping-continue", text: t("mapping.continue") }
        });
    });
}

/**
 * 映射字体补抓后仍失败时给出明确摘要，禁止静默进入导出
 */
export function showMappingFontFailure(failures: readonly MappingFontFailure[]): void {
    const preview = failures
        .slice(0, 5)
        .map((failure) => `• ${failure.task.title}: ${formatMappingFontError(failure.code)}`)
        .join("\n");
    const remaining = failures.length > 5 ? t("mapping.failure.remaining", { count: failures.length - 5 }) : "";
    showMessagePopup({
        tone: "error",
        title: t("mapping.failure.title"),
        message: t("mapping.failure.message", { count: failures.length }),
        details: [preview, remaining].filter(Boolean)
    });
}

/**
 * 在 EPUB 或 HTML 导出前提示映射字型嵌入信息，关闭弹窗或选择返回时解析为 false
 */
export function confirmMappingFontExport(
    format: "EPUB" | "HTML",
    summary: MappingFontSummary,
    owner?: Element
): Promise<boolean> {
    return showDecisionDialog({ dismissed: false, owner, focus: "#esj-mapping-export-continue" }, (finish) => {
        return createConfirmationPopup(finish, {
            id: "esj-mapping-export-confirm",
            title: t("mapping.export.title", { format }),
            body: [
                t("mapping.export.message", {
                    count: summary.chapterCount,
                    bytes: formatMappingFontBytes(summary.fontBytes),
                    format
                })
            ],
            cancel: { text: t("mapping.export.back") },
            confirm: { id: "esj-mapping-export-continue", text: t("mapping.export.continue", { format }) }
        });
    });
}
