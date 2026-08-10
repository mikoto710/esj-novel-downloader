import type { MappingFontDetection, MappingFontFailure, MappingFontSummary } from "../../core/download/contracts";
import { enableDrag, el } from "../../utils/dom";
import { showMessagePopup } from "./message";
import { createCommonHeader } from "./common";
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
    document.querySelector("#esj-mapping-confirm")?.remove();
    if (signal?.aborted) {
        return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (confirmed: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            popup.remove();
            resolve(confirmed);
        };
        const onAbort = () => finish(false);
        const header = createCommonHeader(t("mapping.detected.title"), () => finish(false));
        const body = el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
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
        ]);
        const footer = el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
            el(
                "button",
                {
                    id: "esj-mapping-stop",
                    style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                    onclick: () => finish(false)
                },
                [t("mapping.stop")]
            ),
            el(
                "button",
                {
                    id: "esj-mapping-continue",
                    style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
                    onclick: () => finish(true)
                },
                [t("mapping.continue")]
            )
        ]);
        const popup = el(
            "div",
            {
                id: "esj-mapping-confirm",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:440px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
            },
            [header, body, footer]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-mapping-continue") as HTMLButtonElement | null)?.focus();
        signal?.addEventListener("abort", onAbort, { once: true });
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
export function confirmMappingFontExport(format: "EPUB" | "HTML", summary: MappingFontSummary): Promise<boolean> {
    document.querySelector("#esj-mapping-export-confirm")?.remove();
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (confirmed: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            popup.remove();
            resolve(confirmed);
        };
        const popup = el(
            "div",
            {
                id: "esj-mapping-export-confirm",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:440px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
            },
            [
                createCommonHeader(t("mapping.export.title", { format }), () => finish(false)),
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
                    t("mapping.export.message", {
                        count: summary.chapterCount,
                        bytes: formatMappingFontBytes(summary.fontBytes),
                        format
                    })
                ]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
                    el(
                        "button",
                        {
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: () => finish(false)
                        },
                        [t("mapping.export.back")]
                    ),
                    el(
                        "button",
                        {
                            id: "esj-mapping-export-continue",
                            style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
                            onclick: () => finish(true)
                        },
                        [t("mapping.export.continue", { format })]
                    )
                ])
            ]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-mapping-export-continue") as HTMLButtonElement | null)?.focus();
    });
}
