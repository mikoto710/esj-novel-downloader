import {
    clearDownloadHistory,
    DOWNLOAD_HISTORY_LIMIT,
    listDownloadHistory,
    removeDownloadHistory
} from "../core/download-history";
import { DownloadFormat, DownloadHistoryItem, SourcePageType } from "../types";
import { el, enableDrag } from "../utils/dom";
import { subscribeInterfaceLocaleChange, t } from "./locale";

let disposeActiveHistoryLocaleRefresh: (() => void) | null = null;

function sourceLabel(source: SourcePageType): string {
    return t(
        source === "detail"
            ? "history.source.detail"
            : source === "forum"
              ? "history.source.forum"
              : "history.source.single"
    );
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === today.toDateString()) {
        return t("history.today", { time });
    }
    if (date.toDateString() === yesterday.toDateString()) {
        return t("history.yesterday", { time });
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
        return item.imageEnabled === undefined ? "—" : t("history.image.legacy");
    }
    if (!item.imageInfo.enabled) {
        return t("history.image.disabled");
    }
    const total = item.imageInfo.successCount + item.imageInfo.failureCount;
    if (total === 0) {
        return t("history.image.none");
    }
    return item.imageInfo.failureCount === 0
        ? t("history.image.count", { count: item.imageInfo.successCount })
        : t("history.image.progress", { success: item.imageInfo.successCount, total });
}

function chapterStatusText(item: DownloadHistoryItem): string {
    if (!item.chapterSummary) {
        return item.chapterInfo || "—";
    }
    return item.chapterSummary.missingCount > 0
        ? t("history.chapter.withMissing", {
              total: item.chapterSummary.totalCount,
              missing: item.chapterSummary.missingCount
          })
        : t("history.chapter.total", { total: item.chapterSummary.totalCount });
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
                el("span", { style: "font-weight:bold;" }, [t("history.confirm.title")]),
                el(
                    "button",
                    {
                        title: t("common.close"),
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
            [t("common.cancel")]
        );
        const confirmButton = el(
            "button",
            {
                style: "padding:8px 12px;background:#d9534f;color:#fff;border:none;border-radius:6px;cursor:pointer;",
                onclick: () => cleanup(true)
            },
            [t("history.action.clear")]
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
                    t("history.confirm.message")
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
    disposeActiveHistoryLocaleRefresh?.();
    document.querySelector("#esj-download-history")?.remove();
    document.querySelector("#esj-download-history-confirm")?.remove();
    const close = () => {
        disposeActiveHistoryLocaleRefresh?.();
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
            el("span", { style: "font-weight:bold;" }, [t("history.title")]),
            el(
                "button",
                {
                    title: t("common.close"),
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
            ["all", t("history.filter.allType")],
            ["book", t("history.filter.book")],
            ["single", t("history.filter.single")]
        ])
    );
    const formatSelect = el(
        "select",
        { style: "padding:6px;border:1px solid #ccc;border-radius:5px;" },
        selectOptions([
            ["all", t("history.filter.allFormat")],
            ["txt", "TXT"],
            ["epub", "EPUB"],
            ["html", "HTML"]
        ])
    );
    const sourceSelect = el(
        "select",
        { style: "padding:6px;border:1px solid #ccc;border-radius:5px;" },
        selectOptions([
            ["all", t("history.filter.allSource")],
            ["detail", t("history.source.detail")],
            ["forum", t("history.source.forum")],
            ["single", t("history.source.single")]
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
                    [t("history.column.book"), "21%"],
                    [t("history.column.author"), "12%"],
                    [t("history.column.type"), "9%"],
                    [t("history.column.format"), "8%"],
                    [t("history.column.source"), "8%"],
                    [t("history.column.chapter"), "14%"],
                    [t("history.column.image"), "9%"],
                    [t("history.column.time"), "12%"],
                    [t("history.column.action"), "7%"]
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
        summary.textContent = t("history.summary", {
            shown: filtered.length,
            total: items.length,
            limit: DOWNLOAD_HISTORY_LIMIT
        });
        tableBody.replaceChildren();
        if (filtered.length === 0) {
            tableBody.appendChild(
                el("tr", {}, [
                    el("td", { colspan: 9, style: "padding:48px;text-align:center;color:#777;" }, [t("history.empty")])
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
                    title: t("history.action.open"),
                    style: "border:0;background:none;color:#2b9bd7;cursor:pointer;padding:2px 4px;",
                    onclick: () => window.open(item.pageUrl, "_blank", "noopener")
                },
                [t("history.column.source")]
            );
            const deleteButton = el(
                "button",
                {
                    title: t("history.action.delete"),
                    style: "border:0;background:none;color:#d9534f;cursor:pointer;padding:2px 4px;",
                    onclick: async () => {
                        await removeDownloadHistory(item.id);
                        items = await listDownloadHistory();
                        render();
                    }
                },
                [t("history.action.delete")]
            );
            tableBody.appendChild(
                el("tr", {}, [
                    cell(item.bookName),
                    cell(item.author || "—"),
                    cell(t(item.sourcePageType === "single" ? "history.type.single" : "history.type.book")),
                    cell(item.format.toUpperCase()),
                    cell(sourceLabel(item.sourcePageType)),
                    cell(chapterStatusText(item)),
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
            id: "esj-history-clear",
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
        [t("history.action.clearAll")]
    );
    const refreshButton = el(
        "button",
        {
            id: "esj-history-refresh",
            style: "padding:8px 12px;background:#f5f5f5;color:#333;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
            onclick: () => {
                void listDownloadHistory().then((result) => {
                    items = result;
                    render();
                });
            }
        },
        [t("cache.action.refresh")]
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
                            id: "esj-history-close",
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: close
                        },
                        [t("common.close")]
                    )
                ]
            )
        ]
    );
    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
    const refreshLocaleText = () => {
        const listScrollTop = listBox.scrollTop;
        const headerLabel = header.querySelector("span");
        const headerClose = header.querySelector("button");
        if (headerLabel) {
            headerLabel.textContent = t("history.title");
        }
        if (headerClose) {
            headerClose.setAttribute("title", t("common.close"));
        }
        const optionKeys = new Map<string, Parameters<typeof t>[0]>([
            ["all", "history.filter.allType"],
            ["book", "history.filter.book"],
            ["single", "history.filter.single"]
        ]);
        scopeSelect.querySelectorAll<HTMLOptionElement>("option").forEach((option) => {
            const key = optionKeys.get(option.value);
            if (key) {
                option.textContent = t(key);
            }
        });
        const allFormatOption = formatSelect.querySelector<HTMLOptionElement>('option[value="all"]');
        if (allFormatOption) {
            allFormatOption.textContent = t("history.filter.allFormat");
        }
        const sourceKeys = new Map<string, Parameters<typeof t>[0]>([
            ["all", "history.filter.allSource"],
            ["detail", "history.source.detail"],
            ["forum", "history.source.forum"],
            ["single", "history.source.single"]
        ]);
        sourceSelect.querySelectorAll<HTMLOptionElement>("option").forEach((option) => {
            const key = sourceKeys.get(option.value);
            if (key) {
                option.textContent = t(key);
            }
        });
        const columnKeys: Parameters<typeof t>[0][] = [
            "history.column.book",
            "history.column.author",
            "history.column.type",
            "history.column.format",
            "history.column.source",
            "history.column.chapter",
            "history.column.image",
            "history.column.time",
            "history.column.action"
        ];
        table.querySelectorAll("th").forEach((cell, index) => {
            const key = columnKeys[index];
            if (key) {
                cell.textContent = t(key);
            }
        });
        clearButton.textContent = t("history.action.clearAll");
        refreshButton.textContent = t("cache.action.refresh");
        const closeButton = popup.querySelector("#esj-history-close");
        if (closeButton) {
            closeButton.textContent = t("common.close");
        }
        render();
        listBox.scrollTop = listScrollTop;
    };
    const unsubscribeLocale = subscribeInterfaceLocaleChange(() => {
        if (!popup.isConnected) {
            disposeActiveHistoryLocaleRefresh?.();
            return;
        }
        refreshLocaleText();
    });
    const disposeLocaleRefresh = () => {
        unsubscribeLocale();
        if (disposeActiveHistoryLocaleRefresh === disposeLocaleRefresh) {
            disposeActiveHistoryLocaleRefresh = null;
        }
    };
    disposeActiveHistoryLocaleRefresh = disposeLocaleRefresh;
    void listDownloadHistory().then((result) => {
        items = result;
        render();
    });
}
