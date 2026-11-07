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
    type DiagnosticSessionView,
    type DiagnosticSessionViewStore
} from "../../diagnostics/manager";
import { el, enableDrag, registerElementCleanup, removeElement } from "../dom";
import { createCommonHeader, showDecisionDialog } from "./common";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";
import { createDiagnosticSessionDetail, createDiagnosticSessionRow } from "./diagnostic-session-view";

const DIAGNOSTIC_AUTO_REFRESH_INTERVAL_MS = 3000;
const EMPTY_DIAGNOSTIC_VIEW: DiagnosticSessionViewStore = { active: [], unconfirmed: [], history: [] };
let disposeActiveDiagnosticPopup: (() => void) | null = null;

function formatBytes(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function showClearConfirm(owner: HTMLElement): Promise<boolean> {
    return showDecisionDialog({ dismissed: false, owner, focus: "#esj-diagnostic-clear-cancel" }, (finish) => {
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
        return el(
            "div",
            {
                id: "esj-diagnostic-clear-confirm",
                role: "alertdialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000004;display:flex;flex-direction:column;"
            },
            [header, message, actions]
        );
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

    // 选择和列表快照由当前弹窗持有，异步读取按刷新次序应用
    let selectedId: string | null = null;
    let shownView = EMPTY_DIAGNOSTIC_VIEW;
    let refreshVersion = 0;
    let refreshing = false;
    let changingRecords = false;
    let storageStatus: "common.loading" | "diagnostics.readFailed" | "diagnostics.deleteFailed" | null =
        "common.loading";

    // 关闭时停止轮询和语言订阅，已开始的读取不会重绘已移除的弹窗
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

    // 存储状态独立于会话详情，读取或删除失败时保留可重试的界面
    const storageNotice = el("div", { role: "status", style: "padding:8px 12px;font-size:13px;" });
    const renderStorageNotice = () => {
        storageNotice.hidden = storageStatus === null;
        storageNotice.textContent = storageStatus ? t(storageStatus) : "";
    };
    renderStorageNotice();

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
            onclick: () => void refresh(true)
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
            onclick: () => void changeRecords()
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
                void changeRecords(selected.session.id);
            }
        },
        [t("diagnostics.action.delete")]
    ) as HTMLButtonElement;

    const findSelectedView = (view = shownView, id = selectedId): DiagnosticSessionView | null => {
        const { active, unconfirmed, history } = view;
        return [...active, ...unconfirmed, ...history].find((item) => item.session.id === id) ?? null;
    };

    // 导出前按点击时的选择读取，避免使用另一标签页已删除的记录
    async function readSelectedView(): Promise<DiagnosticSessionView | null> {
        const id = selectedId;
        if (!id) {
            return null;
        }
        try {
            const view = await listBrowserDiagnosticSessionView();
            return popup.isConnected ? findSelectedView(view, id) : null;
        } catch (error) {
            if (popup.isConnected) {
                storageStatus = "diagnostics.readFailed";
                renderStorageNotice();
            }
            console.warn("读取诊断日志失败", error);
            return null;
        }
    }

    async function downloadSelectedDiagnostic(): Promise<void> {
        const selected = await readSelectedView();
        if (!selected) {
            return;
        }
        try {
            const exported = createDiagnosticExport(selected.session, {
                bookTitle: formatDiagnosticBookTitle(selected.session),
                formatLog: formatDiagnosticLog
            });
            triggerDownload(new Blob([exported.json], { type: "application/json;charset=utf-8" }), exported.filename);
        } catch (error) {
            console.error("下载诊断日志失败", error);
        }
    }

    async function copySelectedDiagnostic(): Promise<void> {
        const selected = await readSelectedView();
        if (!selected) {
            return;
        }
        try {
            await copyText(formatDiagnosticSummary(selected.session, selected.presentation));
        } catch (error) {
            console.error("复制诊断摘要失败", error);
        }
    }

    // 选中项决定可用操作，删除期间避免重复提交
    const updateActions = (hasSelection: boolean) => {
        downloadButton.disabled = changingRecords || !hasSelection;
        copyButton.disabled = changingRecords || !hasSelection;
        deleteButton.disabled = changingRecords || !hasSelection;
        clearButton.disabled = changingRecords;
    };

    const renderDetail = (view: DiagnosticSessionView | null) => {
        updateActions(Boolean(view));
        detail.replaceChildren(...createDiagnosticSessionDetail(view));
    };

    // 按活动、待确认和最近记录分组，点击行后同步右侧详情
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
                render(shownView);
            });
            list.appendChild(row);
        });
    }

    const render = (view: DiagnosticSessionViewStore, preserveScroll = false) => {
        const listScrollTop = preserveScroll ? list.scrollTop : 0;
        const detailScrollTop = preserveScroll ? detail.scrollTop : 0;
        shownView = view;

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

    // 只应用本弹窗最新的读取，清除确认和删除期间暂停刷新
    async function refresh(preserveScroll = false): Promise<void> {
        if (changingRecords) {
            return;
        }
        const version = ++refreshVersion;
        refreshing = true;
        try {
            const view = await listBrowserDiagnosticSessionView();
            if (disposed || !popup.isConnected || version !== refreshVersion) {
                return;
            }
            if (storageStatus !== "diagnostics.deleteFailed") {
                storageStatus = null;
                renderStorageNotice();
            }
            render(view, preserveScroll);
        } catch (error) {
            if (!disposed && popup.isConnected && version === refreshVersion) {
                storageStatus = "diagnostics.readFailed";
                renderStorageNotice();
            }
            console.warn("读取诊断日志失败", error);
        } finally {
            if (version === refreshVersion) {
                refreshing = false;
            }
        }
    }

    async function changeRecords(sessionId?: string): Promise<void> {
        if (changingRecords) {
            return;
        }
        changingRecords = true;
        // 确认和删除期间让此前发出的读取失效
        refreshVersion++;
        refreshing = false;
        updateActions(Boolean(findSelectedView()));
        let changed = false;
        try {
            if (sessionId === undefined) {
                if (!(await showClearConfirm(popup))) {
                    return;
                }
                await clearBrowserDiagnosticSessions();
            } else {
                await removeBrowserDiagnosticSession(sessionId);
            }
            changed = true;
            storageStatus = null;
            if (!disposed && popup.isConnected) {
                // 已提交的删除立即反映在当前列表，刷新失败也不会保留已删记录
                const keep = ({ session }: DiagnosticSessionView) => session.id !== sessionId;
                const view =
                    sessionId === undefined
                        ? EMPTY_DIAGNOSTIC_VIEW
                        : {
                              active: shownView.active.filter(keep),
                              unconfirmed: shownView.unconfirmed.filter(keep),
                              history: shownView.history.filter(keep)
                          };
                render(view, true);
            }
        } catch (error) {
            storageStatus = "diagnostics.deleteFailed";
            console.warn("删除诊断日志失败", error);
        } finally {
            changingRecords = false;
            if (!disposed && popup.isConnected) {
                renderStorageNotice();
                if (changed) {
                    await refresh(true);
                }
                updateActions(Boolean(findSelectedView()));
            }
        }
    }

    const refreshAutomatically = () => {
        if (disposed || !popup.isConnected) {
            dispose();
            return;
        }

        if (document.visibilityState === "visible" && !refreshing) {
            void refresh(true);
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
        [header, retentionNotice, storageNotice, sessionContent, actions]
    );

    document.body.appendChild(popup);
    registerElementCleanup(popup, dispose);
    acquirePageActionGroupLockForPopup(popup);
    enableDrag(popup, ".esj-common-header");

    // 先建立空详情，再异步载入会话
    renderDetail(null);
    void refresh();

    // 切换语言时重绘当前会话快照并保留滚动位置
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
        renderStorageNotice();
        render(shownView, true);
    });
    disposeActiveDiagnosticPopup = dispose;
    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleAutoRefresh();
}
