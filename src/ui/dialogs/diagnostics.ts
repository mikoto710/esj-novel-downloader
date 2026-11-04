import { createDiagnosticExport } from "../../diagnostics/export";
import { formatDiagnosticSummary, formatDiagnosticBookTitle, formatDiagnosticLog } from "../messages/diagnostics";
import { triggerDownload, copyText } from "../../browser/files";
import {
    clearBrowserDiagnosticSessions,
    listBrowserDiagnosticSessionView,
    removeBrowserDiagnosticSession
} from "../../diagnostics/runtime";
import {
    DIAGNOSTIC_HISTORY_LIMIT,
    DIAGNOSTIC_RETENTION_MS,
    DIAGNOSTIC_SESSION_BYTES_LIMIT,
    DIAGNOSTIC_TOTAL_BYTES_LIMIT,
    type DiagnosticSessionView
} from "../../diagnostics/manager";
import { el, enableDrag, registerElementCleanup, removeElement } from "../dom";
import { createCommonHeader } from "./common";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";
import { createDiagnosticSessionDetail, createDiagnosticSessionRow } from "./diagnostic-session-view";

const DIAGNOSTIC_AUTO_REFRESH_INTERVAL_MS = 3000;
let disposeActiveDiagnosticPopup: (() => void) | null = null;

function formatBytes(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function showClearConfirm(): Promise<boolean> {
    document.querySelector("#esj-diagnostic-clear-confirm")?.remove();

    return new Promise((resolve) => {
        const finish = (confirmed: boolean) => {
            confirmPopup.remove();
            resolve(confirmed);
        };
        const header = createCommonHeader(t("diagnostics.confirm.title"), () => finish(false));
        const message = el("div", { style: "padding:16px;font-size:15px;line-height:1.7;color:#333;" }, [
            t("diagnostics.confirm.message")
        ]);
        const cancelButton = el(
            "button",
            {
                id: "esj-diagnostic-clear-cancel",
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: () => finish(false)
            },
            [t("common.cancel")]
        );
        const confirmButton = el(
            "button",
            {
                id: "esj-diagnostic-clear-confirm-button",
                style: "padding:8px 12px;background:#d9534f;color:#fff;border:1px solid #d9534f;border-radius:6px;cursor:pointer;",
                onclick: () => finish(true)
            },
            [t("cache.action.clear")]
        );
        const actions = el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
            cancelButton,
            confirmButton
        ]);
        const confirmPopup = el(
            "div",
            {
                id: "esj-diagnostic-clear-confirm",
                role: "alertdialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000004;display:flex;flex-direction:column;"
            },
            [header, message, actions]
        );
        document.body.appendChild(confirmPopup);
        enableDrag(confirmPopup, ".esj-common-header");
        (confirmPopup.querySelector("#esj-diagnostic-clear-cancel") as HTMLButtonElement).focus();
    });
}

/**
 * 创建诊断历史与导出弹窗
 */
export function createDiagnosticPopup(): void {
    const existingPopup = document.querySelector("#esj-diagnostics") as HTMLElement | null;
    removeElement(existingPopup);
    disposeActiveDiagnosticPopup?.();
    removeElement(document.querySelector("#esj-settings"));

    let selectedId: string | null = null;
    let refreshTimer: number | null = null;
    let stopLocaleRefresh: () => void = () => {};
    let disposed = false;
    const dispose = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        if (refreshTimer !== null) {
            window.clearInterval(refreshTimer);
            refreshTimer = null;
        }
        document.removeEventListener("visibilitychange", onVisibilityChange);
        stopLocaleRefresh();
        document.querySelector("#esj-diagnostic-clear-confirm")?.remove();
        if (disposeActiveDiagnosticPopup === dispose) {
            disposeActiveDiagnosticPopup = null;
        }
    };
    const close = () => {
        removeElement(popup);
    };
    const header = createCommonHeader(t("diagnostics.title"), close);
    const retentionNotice = el("div", {
        style: "padding:8px 12px;background:#f7f7f7;border-bottom:1px solid #ddd;color:#666;font-size:12px;"
    });
    const refreshRetentionNotice = () => {
        retentionNotice.textContent = t("diagnostics.retention", {
            limit: DIAGNOSTIC_HISTORY_LIMIT,
            days: Math.round(DIAGNOSTIC_RETENTION_MS / 86400000),
            single: formatBytes(DIAGNOSTIC_SESSION_BYTES_LIMIT),
            total: formatBytes(DIAGNOSTIC_TOTAL_BYTES_LIMIT)
        });
    };
    refreshRetentionNotice();

    // 左侧选择会话，右侧展示所选会话；两栏各自滚动
    const list = el("div", {
        id: "esj-diagnostic-list",
        style: "width:280px;min-width:280px;border-right:1px solid #ddd;overflow:auto;background:#fafafa;"
    });
    const detail = el("div", {
        id: "esj-diagnostic-detail",
        style: "flex:1;min-width:0;padding:16px;overflow:auto;color:#333;"
    });

    // 刷新和清空作用于列表，复制、下载和删除作用于所选会话
    const buttonStyle = "padding:8px 12px;border-radius:6px;cursor:pointer;border:1px solid #ccc;";
    const refreshButton = el(
        "button",
        {
            id: "esj-diagnostic-refresh",
            style: `${buttonStyle}background:#eee;margin-right:auto;`,
            onclick: () => render({ preserveScroll: true })
        },
        [t("cache.action.refresh")]
    ) as HTMLButtonElement;
    const downloadButton = el(
        "button",
        {
            id: "esj-diagnostic-download",
            style: `${buttonStyle}background:#2b9bd7;color:#fff;border-color:#2b9bd7;`,
            onclick: downloadSelectedDiagnostic
        },
        [t("diagnostics.action.download")]
    ) as HTMLButtonElement;
    const copyButton = el(
        "button",
        {
            id: "esj-diagnostic-copy",
            style: `${buttonStyle}background:#eee;`,
            onclick: copySelectedDiagnostic
        },
        [t("diagnostics.action.copy")]
    ) as HTMLButtonElement;
    const clearButton = el(
        "button",
        {
            id: "esj-diagnostic-clear",
            style: `${buttonStyle}background:#fff;color:#c62828;border-color:#d9534f;`,
            onclick: async () => {
                if (!(await showClearConfirm())) {
                    return;
                }
                clearBrowserDiagnosticSessions();
                selectedId = null;
                render();
            }
        },
        [t("diagnostics.action.clearAll")]
    ) as HTMLButtonElement;
    const deleteButton = el(
        "button",
        {
            id: "esj-diagnostic-delete",
            style: `${buttonStyle}background:#fff;color:#c62828;border-color:#d9534f;`,
            onclick: () => {
                const selected = findSelectedView();
                if (!selected) {
                    return;
                }
                removeBrowserDiagnosticSession(selected.session.id);
                selectedId = null;
                render();
            }
        },
        [t("diagnostics.action.delete")]
    ) as HTMLButtonElement;

    const findSelectedView = (): DiagnosticSessionView | null => {
        const view = listBrowserDiagnosticSessionView();
        return (
            [...view.active, ...view.unconfirmed, ...view.history].find((item) => item.session.id === selectedId) ||
            null
        );
    };

    function downloadSelectedDiagnostic(): void {
        const selected = findSelectedView();
        if (selected) {
            const exported = createDiagnosticExport(selected.session, {
                bookTitle: formatDiagnosticBookTitle(selected.session),
                formatLog: formatDiagnosticLog
            });
            triggerDownload(new Blob([exported.json], { type: "application/json;charset=utf-8" }), exported.filename);
        }
    }

    async function copySelectedDiagnostic(): Promise<void> {
        const selected = findSelectedView();
        if (!selected) {
            return;
        }
        try {
            await copyText(formatDiagnosticSummary(selected.session, selected.presentation));
        } catch (error) {
            console.error("复制诊断摘要失败", error);
        }
    }

    const renderDetail = (view: DiagnosticSessionView | null) => {
        detail.replaceChildren();
        downloadButton.disabled = !view;
        copyButton.disabled = !view;
        deleteButton.disabled = !view;
        detail.append(...createDiagnosticSessionDetail(view));
    };

    // 按活动、待确认和最近记录分组，点击行后同步右侧详情。
    function appendSessionSection(title: string, items: DiagnosticSessionView[]): void {
        if (items.length === 0) {
            return;
        }
        const sectionTitle = el("div", { style: "padding:9px 12px;color:#777;font-size:12px;font-weight:bold;" }, [
            title
        ]);
        list.appendChild(sectionTitle);
        items.forEach((item) => {
            const row = createDiagnosticSessionRow(item, item.session.id === selectedId, () => {
                selectedId = item.session.id;
                render();
            });
            list.appendChild(row);
        });
    }

    const render = ({ preserveScroll = false }: { preserveScroll?: boolean } = {}) => {
        const listScrollTop = preserveScroll ? list.scrollTop : 0;
        const detailScrollTop = preserveScroll ? detail.scrollTop : 0;
        const view = listBrowserDiagnosticSessionView();

        // 已观察到页面关闭但终态未确认的会话单独列出，仍可查看、导出和删除
        const sessions = [...view.active, ...view.unconfirmed, ...view.history];
        if (!selectedId || !sessions.some((item) => item.session.id === selectedId)) {
            selectedId = sessions[0]?.session.id || null;
        }
        list.replaceChildren();
        if (sessions.length === 0) {
            list.appendChild(
                el("div", { style: "padding:40px 12px;text-align:center;color:#777;" }, [t("diagnostics.empty")])
            );
        } else {
            appendSessionSection(t("diagnostics.section.active"), view.active);
            appendSessionSection(t("diagnostics.section.unconfirmed"), view.unconfirmed);
            appendSessionSection(t("diagnostics.section.recent", { limit: DIAGNOSTIC_HISTORY_LIMIT }), view.history);
        }
        renderDetail(sessions.find((item) => item.session.id === selectedId) || null);
        if (preserveScroll) {
            list.scrollTop = listScrollTop;
            detail.scrollTop = detailScrollTop;
        }
    };

    const refreshAutomatically = () => {
        if (disposed || !popup.isConnected) {
            dispose();
            return;
        }

        // 清除确认期间不重绘，保留用户当前操作与确认对话框的归属
        if (document.visibilityState === "visible" && !document.querySelector("#esj-diagnostic-clear-confirm")) {
            render({ preserveScroll: true });
        }
    };

    // 只在页面可见时轮询，回到前台立即刷新
    const scheduleAutoRefresh = () => {
        if (refreshTimer !== null) {
            window.clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (!disposed && document.visibilityState === "visible") {
            refreshTimer = window.setInterval(refreshAutomatically, DIAGNOSTIC_AUTO_REFRESH_INTERVAL_MS);
        }
    };

    function onVisibilityChange(): void {
        scheduleAutoRefresh();
        if (document.visibilityState === "visible") {
            refreshAutomatically();
        }
    }

    // 保留说明和操作栏固定，双栏内容填满中间剩余高度
    const sessionContent = el("div", { style: "display:flex;flex:1;min-height:0;" }, [list, detail]);
    const actions = el(
        "div",
        { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #ddd;" },
        [refreshButton, deleteButton, clearButton, copyButton, downloadButton]
    );
    const popup = el(
        "div",
        {
            id: "esj-diagnostics",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:760px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000003;display:flex;flex-direction:column;"
        },
        [header, retentionNotice, sessionContent, actions]
    );

    document.body.appendChild(popup);
    registerElementCleanup(popup, dispose);
    acquirePageActionGroupLockForPopup(popup);
    enableDrag(popup, ".esj-common-header");
    render();
    stopLocaleRefresh = subscribeInterfaceLocaleChange(() => {
        if (!popup.isConnected) {
            dispose();
            return;
        }
        const headerLabel = header.querySelector("span");
        if (headerLabel) {
            headerLabel.textContent = t("diagnostics.title");
        }
        refreshRetentionNotice();
        refreshButton.textContent = t("cache.action.refresh");
        downloadButton.textContent = t("diagnostics.action.download");
        copyButton.textContent = t("diagnostics.action.copy");
        clearButton.textContent = t("diagnostics.action.clearAll");
        deleteButton.textContent = t("diagnostics.action.delete");
        render({ preserveScroll: true });
    });
    disposeActiveDiagnosticPopup = dispose;
    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleAutoRefresh();
}
