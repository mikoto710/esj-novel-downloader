import {
    clearDownloadHistory,
    DOWNLOAD_HISTORY_LIMIT,
    listDownloadHistory,
    removeDownloadHistory
} from "../core/download-history";
import { DownloadFormat, DownloadHistoryItem, SourcePageType } from "../types";
import { el, enableDrag } from "../utils/dom";

function sourceLabel(source: SourcePageType): string {
    return source === "detail" ? "详情页" : source === "forum" ? "论坛页" : "单章页";
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === today.toDateString()) {
        return `今天 ${time}`;
    }
    if (date.toDateString() === yesterday.toDateString()) {
        return `昨天 ${time}`;
    }
    return date.toLocaleString();
}

function selectOptions(values: Array<[string, string]>): HTMLElement[] {
    return values.map(([value, text]) => el("option", { value }, [text]));
}

function imageStatusText(item: DownloadHistoryItem): string {
    if (item.format === "txt") {
        return "—";
    }
    if (!item.imageInfo) {
        return item.imageEnabled === undefined ? "—" : "旧记录";
    }
    if (!item.imageInfo.enabled) {
        return "未启用";
    }
    const total = item.imageInfo.successCount + item.imageInfo.failureCount;
    if (total === 0) {
        return "无插图";
    }
    return item.imageInfo.failureCount === 0
        ? `${item.imageInfo.successCount} 张`
        : `${item.imageInfo.successCount} / ${total} 张`;
}

// 显示清空下载记录确认弹窗
function showHistoryClearConfirm(): Promise<boolean> {
    document.querySelector("#esj-download-history-confirm")?.remove();

    return new Promise((resolve) => {
        const cleanup = (confirmed: boolean) => {
            popup.remove();
            resolve(confirmed);
        };
        const header = el(
            "div",
            {
                className: "esj-common-header",
                style: "padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;"
            },
            [
                el("span", { style: "font-weight:bold;" }, ["🗑️ 清空确认"]),
                el(
                    "button",
                    {
                        title: "关闭",
                        style: "border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;",
                        onclick: () => cleanup(false)
                    },
                    ["✕"]
                )
            ]
        );
        const cancelButton = el(
            "button",
            {
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: () => cleanup(false)
            },
            ["取消"]
        );
        const confirmButton = el(
            "button",
            {
                style: "padding:8px 12px;background:#d9534f;color:#fff;border:none;border-radius:6px;cursor:pointer;",
                onclick: () => cleanup(true)
            },
            ["清空"]
        );
        const popup = el(
            "div",
            {
                id: "esj-download-history-confirm",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000000;display:flex;flex-direction:column;"
            },
            [
                header,
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
                    "确定清空全部下载记录吗？此操作无法恢复。"
                ]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
                    cancelButton,
                    confirmButton
                ])
            ]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
    });
}

/**
 * 创建下载记录弹窗
 */
export function createDownloadHistoryPopup(): void {
    document.querySelector("#esj-download-history")?.remove();
    document.querySelector("#esj-download-history-confirm")?.remove();
    const close = () => {
        document.querySelector("#esj-download-history")?.remove();
        document.querySelector("#esj-download-history-confirm")?.remove();
        document.querySelectorAll(".esj-settings-trigger").forEach((button) => {
            (button as HTMLButtonElement).disabled = false;
        });
    };
    const header = el(
        "div",
        {
            className: "esj-common-header",
            style: "padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;"
        },
        [
            el("span", { style: "font-weight:bold;" }, ["⬇️ 下载记录"]),
            el(
                "button",
                {
                    title: "关闭",
                    style: "border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;",
                    onclick: close
                },
                ["✕"]
            )
        ]
    );

    const scopeSelect = el(
        "select",
        { style: "padding:6px;border:1px solid #ccc;border-radius:5px;" },
        selectOptions([
            ["all", "全部类型"],
            ["book", "全本"],
            ["single", "单章"]
        ])
    );
    const formatSelect = el(
        "select",
        { style: "padding:6px;border:1px solid #ccc;border-radius:5px;" },
        selectOptions([
            ["all", "全部格式"],
            ["txt", "TXT"],
            ["epub", "EPUB"],
            ["html", "HTML"]
        ])
    );
    const sourceSelect = el(
        "select",
        { style: "padding:6px;border:1px solid #ccc;border-radius:5px;" },
        selectOptions([
            ["all", "全部来源"],
            ["detail", "详情页"],
            ["forum", "论坛页"],
            ["single", "单章页"]
        ])
    );
    const summary = el("span", { style: "margin-left:auto;color:#666;font-size:12px;" });
    const tableBody = el("tbody");
    const table = el("table", { style: "width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;" }, [
        el("thead", { style: "position:sticky;top:0;background:#f7f7f7;z-index:1;" }, [
            el(
                "tr",
                {},
                [
                    ["书名", "21%"],
                    ["作者", "12%"],
                    ["导出类型", "9%"],
                    ["格式", "8%"],
                    ["来源", "8%"],
                    ["章节", "14%"],
                    ["插图", "9%"],
                    ["时间", "12%"],
                    ["操作", "7%"]
                ].map(([text, width], index) =>
                    el(
                        "th",
                        {
                            style: `width:${width};padding:10px 8px;text-align:${index === 8 ? "center" : "left"};border-bottom:1px solid #ddd;white-space:nowrap;`
                        },
                        [text]
                    )
                )
            )
        ]),
        tableBody
    ]);
    const listBox = el("div", { style: "flex:1;min-height:0;overflow:auto;padding:0 16px 16px;" }, [table]);
    let items: DownloadHistoryItem[] = [];

    // 按导出范围、格式和来源筛选并重建记录列表
    const render = () => {
        const scope = (scopeSelect as HTMLSelectElement).value;
        const format = (formatSelect as HTMLSelectElement).value as "all" | DownloadFormat;
        const source = (sourceSelect as HTMLSelectElement).value;
        const filtered = items.filter(
            (item) =>
                (scope === "all" ||
                    (scope === "single" ? item.sourcePageType === "single" : item.sourcePageType !== "single")) &&
                (format === "all" || item.format === format) &&
                (source === "all" || item.sourcePageType === source)
        );
        summary.textContent = `显示 ${filtered.length} / 共 ${items.length} 条，最多保留 ${DOWNLOAD_HISTORY_LIMIT} 条`;
        tableBody.replaceChildren();
        if (filtered.length === 0) {
            tableBody.appendChild(
                el("tr", {}, [
                    el("td", { colspan: 9, style: "padding:48px;text-align:center;color:#777;" }, ["暂无下载记录"])
                ])
            );
            return;
        }
        filtered.forEach((item) => {
            const cell = (text: string, title = text) =>
                el(
                    "td",
                    {
                        title,
                        style: "padding:10px 8px;border-bottom:1px solid #eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                    },
                    [text]
                );
            const openButton = el(
                "button",
                {
                    title: "打开原页",
                    style: "border:0;background:none;color:#2b9bd7;cursor:pointer;padding:2px 4px;",
                    onclick: () => window.open(item.pageUrl, "_blank", "noopener")
                },
                ["来源"]
            );
            const deleteButton = el(
                "button",
                {
                    title: "删除记录",
                    style: "border:0;background:none;color:#d9534f;cursor:pointer;padding:2px 4px;",
                    onclick: async () => {
                        await removeDownloadHistory(item.id);
                        items = await listDownloadHistory();
                        render();
                    }
                },
                ["删除"]
            );
            tableBody.appendChild(
                el("tr", {}, [
                    cell(item.bookName),
                    cell(item.author || "—"),
                    cell(item.sourcePageType === "single" ? "单章" : "全本"),
                    cell(item.format.toUpperCase()),
                    cell(sourceLabel(item.sourcePageType)),
                    cell(item.chapterInfo || "—"),
                    cell(imageStatusText(item)),
                    cell(formatTime(item.exportedAt)),
                    el("td", { style: "padding:10px 8px;border-bottom:1px solid #eee;" }, [
                        el(
                            "div",
                            {
                                style: "display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;"
                            },
                            [openButton, deleteButton]
                        )
                    ])
                ])
            );
        });
    };

    [scopeSelect, formatSelect, sourceSelect].forEach((select) => select.addEventListener("change", render));
    const clearButton = el(
        "button",
        {
            style: "padding:8px 12px;background:#d9534f;color:#fff;border:0;border-radius:6px;cursor:pointer;",
            onclick: async () => {
                const confirmed = await showHistoryClearConfirm();
                if (!confirmed) {
                    return;
                }
                await clearDownloadHistory();
                items = await listDownloadHistory();
                render();
            }
        },
        ["清空全部记录"]
    );
    const refreshButton = el(
        "button",
        {
            style: "padding:8px 12px;background:#f5f5f5;color:#333;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
            onclick: () => {
                void listDownloadHistory().then((result) => {
                    items = result;
                    render();
                });
            }
        },
        ["刷新"]
    );
    const popup = el(
        "div",
        {
            id: "esj-download-history",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(960px,calc(100vw - 32px));height:min(640px,calc(100vh - 32px));background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;display:flex;flex-direction:column;"
        },
        [
            header,
            el("div", { style: "padding:14px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;" }, [
                scopeSelect,
                formatSelect,
                sourceSelect,
                summary
            ]),
            listBox,
            el(
                "div",
                { style: "padding:12px 16px;border-top:1px solid #eee;display:flex;justify-content:space-between;" },
                [
                    el("div", { style: "display:flex;gap:8px;" }, [refreshButton, clearButton]),
                    el(
                        "button",
                        {
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: close
                        },
                        ["关闭"]
                    )
                ]
            )
        ]
    );
    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
    void listDownloadHistory().then((result) => {
        items = result;
        render();
    });
}
