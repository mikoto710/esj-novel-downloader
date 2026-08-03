import {
    clearBrowserDiagnosticSessions,
    createBrowserDiagnosticExport,
    downloadBrowserDiagnosticSession,
    formatBrowserDiagnosticSummary,
    listBrowserDiagnosticSessions,
    removeBrowserDiagnosticSession
} from "../adapters/browser-diagnostics";
import {
    DIAGNOSTIC_HISTORY_LIMIT,
    DIAGNOSTIC_RETENTION_MS,
    DIAGNOSTIC_SESSION_BYTES_LIMIT,
    DIAGNOSTIC_TOTAL_BYTES_LIMIT,
    type DiagnosticResult,
    type DiagnosticSession
} from "../core/diagnostics";
import { el, enableDrag } from "../utils/dom";
import { createCommonHeader } from "./popup-components";

const resultPresentation: Record<DiagnosticResult, { icon: string; label: string; color: string }> = {
    running: { icon: "🔄", label: "进行中", color: "#2b9bd7" },
    success: { icon: "✅", label: "下载完成", color: "#2e7d32" },
    cancelled: { icon: "🛑", label: "用户取消", color: "#777" },
    failed: { icon: "❌", label: "任务失败", color: "#c62828" },
    interrupted: { icon: "⚠️", label: "异常中断", color: "#a05a00" }
};

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

function formatBytes(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function sessionResult(session: DiagnosticSession): { icon: string; label: string; color: string } {
    if (session.failures.some((failure) => failure.scope === "export") && session.result === "success") {
        return { icon: "⚠️", label: "导出异常", color: "#a05a00" };
    }
    return resultPresentation[session.result];
}

async function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
}

/**
 * 创建诊断历史与导出弹窗
 */
export function createDiagnosticPopup(): void {
    const existingPopup = document.querySelector("#esj-diagnostics") as HTMLElement | null;
    const openedFromSettings =
        existingPopup?.dataset.releaseSettingsLock === "true" || Boolean(document.querySelector("#esj-settings"));
    existingPopup?.remove();
    document.querySelector("#esj-settings")?.remove();

    let selectedId: string | null = null;
    const toggleSettingsLock = (locked: boolean) => {
        document.querySelectorAll(".esj-settings-trigger").forEach((button) => {
            (button as HTMLButtonElement).disabled = locked;
        });
    };
    const close = () => {
        document.querySelector("#esj-diagnostic-clear-confirm")?.remove();
        popup.remove();
        // 只有从设置面板进入时，诊断弹窗才接管并负责释放设置按钮锁。
        if (openedFromSettings) {
            toggleSettingsLock(false);
        }
    };
    const header = createCommonHeader("🩺 诊断日志", close);
    const list = el("div", {
        id: "esj-diagnostic-list",
        style: "width:280px;min-width:280px;border-right:1px solid #ddd;overflow:auto;background:#fafafa;"
    });
    const detail = el("div", {
        id: "esj-diagnostic-detail",
        style: "flex:1;min-width:0;padding:16px;overflow:auto;color:#333;"
    });
    const buttonStyle = "padding:8px 12px;border-radius:6px;cursor:pointer;border:1px solid #ccc;";
    const refreshButton = el(
        "button",
        {
            id: "esj-diagnostic-refresh",
            style: `${buttonStyle}background:#eee;margin-right:auto;`,
            onclick: () => render()
        },
        ["刷新"]
    ) as HTMLButtonElement;
    const downloadButton = el(
        "button",
        {
            id: "esj-diagnostic-download",
            style: `${buttonStyle}background:#2b9bd7;color:#fff;border-color:#2b9bd7;`,
            onclick: () => {
                const selected = findSelected();
                if (selected) {
                    downloadBrowserDiagnosticSession(selected);
                }
            }
        },
        ["下载诊断日志"]
    ) as HTMLButtonElement;
    const copyButton = el(
        "button",
        {
            id: "esj-diagnostic-copy",
            style: `${buttonStyle}background:#eee;`,
            onclick: async () => {
                const selected = findSelected();
                if (!selected) {
                    return;
                }
                try {
                    await copyText(formatBrowserDiagnosticSummary(selected));
                } catch (error) {
                    console.error("复制诊断摘要失败", error);
                }
            }
        },
        ["复制摘要"]
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
        ["清除全部"]
    ) as HTMLButtonElement;
    const deleteButton = el(
        "button",
        {
            id: "esj-diagnostic-delete",
            style: `${buttonStyle}background:#fff;color:#c62828;border-color:#d9534f;`,
            onclick: () => {
                const selected = findSelected();
                if (!selected) {
                    return;
                }
                removeBrowserDiagnosticSession(selected.id);
                selectedId = null;
                render();
            }
        },
        ["删除记录"]
    ) as HTMLButtonElement;

    const findSelected = (): DiagnosticSession | null => {
        const store = listBrowserDiagnosticSessions();
        return [...store.active, ...store.history].find((session) => session.id === selectedId) || null;
    };

    const renderDetail = (session: DiagnosticSession | null) => {
        detail.replaceChildren();
        downloadButton.disabled = !session;
        copyButton.disabled = !session;
        deleteButton.disabled = !session;
        if (!session) {
            detail.appendChild(
                el("div", { style: "padding:50px 12px;text-align:center;color:#777;" }, ["暂无诊断记录"])
            );
            return;
        }
        const presentation = sessionResult(session);
        const exported = createBrowserDiagnosticExport(session);
        detail.append(
            el("div", { style: "font-size:18px;font-weight:bold;margin-bottom:6px;overflow-wrap:anywhere;" }, [
                session.book.title
            ]),
            el("div", { style: `color:${presentation.color};font-weight:bold;margin-bottom:12px;` }, [
                `${presentation.icon} ${presentation.label}`
            ]),
            el(
                "div",
                {
                    style: "padding:10px 12px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:6px;line-height:1.6;margin-bottom:12px;"
                },
                [
                    "诊断文件包含作品名称、作品链接和失败章节信息，但不包含小说正文、登录凭据、图片或字体内容。请确认后再公开分享。"
                ]
            ),
            el(
                "pre",
                {
                    style: "margin:0;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f7f7;border:1px solid #ddd;border-radius:6px;font:13px/1.65 monospace;"
                },
                [formatBrowserDiagnosticSummary(session)]
            ),
            el("div", { style: "margin-top:10px;color:#777;font-size:12px;overflow-wrap:anywhere;" }, [
                `文件：${exported.filename}`
            ])
        );
    };

    const render = () => {
        const store = listBrowserDiagnosticSessions();
        // 进行中会话单独置顶，不占最近 10 条历史名额
        const sessions = [...store.active, ...store.history];
        if (!selectedId || !sessions.some((session) => session.id === selectedId)) {
            selectedId = sessions[0]?.id || null;
        }
        list.replaceChildren();
        if (sessions.length === 0) {
            list.appendChild(el("div", { style: "padding:40px 12px;text-align:center;color:#777;" }, ["暂无记录"]));
        } else {
            const appendSection = (title: string, items: DiagnosticSession[]) => {
                if (items.length === 0) {
                    return;
                }
                list.appendChild(
                    el("div", { style: "padding:9px 12px;color:#777;font-size:12px;font-weight:bold;" }, [title])
                );
                items.forEach((session) => {
                    const presentation = sessionResult(session);
                    const selected = session.id === selectedId;
                    const row = el(
                        "button",
                        {
                            type: "button",
                            style: `display:block;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #eee;background:${selected ? "#e8f5fc" : "transparent"};text-align:left;cursor:pointer;`,
                            onclick: () => {
                                selectedId = session.id;
                                render();
                            }
                        },
                        [
                            el("div", { style: `color:${presentation.color};font-weight:bold;` }, [
                                `${presentation.icon} ${presentation.label}`
                            ]),
                            el(
                                "div",
                                {
                                    title: session.book.title,
                                    style: "margin-top:3px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                                },
                                [session.book.title]
                            ),
                            el("div", { style: "margin-top:2px;color:#888;font-size:11px;" }, [
                                formatTime(session.updatedAt)
                            ])
                        ]
                    );
                    list.appendChild(row);
                });
            };
            appendSection("进行中", store.active);
            appendSection(`最近任务（最多 ${DIAGNOSTIC_HISTORY_LIMIT} 条）`, store.history);
        }
        renderDetail(findSelected());
    };

    const popup = el(
        "div",
        {
            id: "esj-diagnostics",
            "data-release-settings-lock": openedFromSettings ? "true" : "false",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:760px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000003;display:flex;flex-direction:column;"
        },
        [
            header,
            el(
                "div",
                {
                    style: "padding:8px 12px;background:#f7f7f7;border-bottom:1px solid #ddd;color:#666;font-size:12px;"
                },
                [
                    `历史最多 ${DIAGNOSTIC_HISTORY_LIMIT} 条 / ${Math.round(DIAGNOSTIC_RETENTION_MS / 86400000)} 天；单条 ${formatBytes(DIAGNOSTIC_SESSION_BYTES_LIMIT)}，总计 ${formatBytes(DIAGNOSTIC_TOTAL_BYTES_LIMIT)}`
                ]
            ),
            el("div", { style: "display:flex;flex:1;min-height:0;" }, [list, detail]),
            el(
                "div",
                { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #ddd;" },
                [refreshButton, deleteButton, clearButton, copyButton, downloadButton]
            )
        ]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
    render();

    function showClearConfirm(): Promise<boolean> {
        document.querySelector("#esj-diagnostic-clear-confirm")?.remove();

        return new Promise((resolve) => {
            const finish = (confirmed: boolean) => {
                confirmPopup.remove();
                resolve(confirmed);
            };
            const confirmPopup = el(
                "div",
                {
                    id: "esj-diagnostic-clear-confirm",
                    role: "alertdialog",
                    "aria-modal": "true",
                    style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000004;display:flex;flex-direction:column;"
                },
                [
                    createCommonHeader("🗑️ 清除确认", () => finish(false)),
                    el("div", { style: "padding:16px;font-size:15px;line-height:1.7;color:#333;" }, [
                        "确定清除全部诊断记录吗？这也会清除其他页面的进行中记录，且无法恢复。"
                    ]),
                    el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
                        el(
                            "button",
                            {
                                id: "esj-diagnostic-clear-cancel",
                                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                                onclick: () => finish(false)
                            },
                            ["取消"]
                        ),
                        el(
                            "button",
                            {
                                id: "esj-diagnostic-clear-confirm-button",
                                style: "padding:8px 12px;background:#d9534f;color:#fff;border:1px solid #d9534f;border-radius:6px;cursor:pointer;",
                                onclick: () => finish(true)
                            },
                            ["清除"]
                        )
                    ])
                ]
            );
            document.body.appendChild(confirmPopup);
            enableDrag(confirmPopup, ".esj-common-header");
            (confirmPopup.querySelector("#esj-diagnostic-clear-cancel") as HTMLButtonElement).focus();
        });
    }
}
