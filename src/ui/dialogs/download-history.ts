import {
    clearDownloadHistory,
    DOWNLOAD_HISTORY_LIMIT,
    listDownloadHistory,
    removeDownloadHistory
} from "../../core/download-history";
import { DownloadFormat, DownloadHistoryItem, SourcePageType } from "../../types";
import { el, enableDrag } from "../../utils/dom";
import { subscribeInterfaceLocaleChange, t } from "../locale";

let disposeActiveHistoryLocaleRefresh: (() => void) | null = null;
let disposeActiveHistoryColumnResize: (() => void) | null = null;

const HISTORY_MIN_COLUMN_WIDTH = 48;

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

function enableHistoryColumnResize(table: HTMLTableElement): () => void {
    const columns = Array.from(table.querySelectorAll<HTMLTableColElement>("col"));
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    const listeners: Array<{ handle: HTMLElement; onMouseDown: (event: MouseEvent) => void }> = [];
    let finishActiveResize: (() => void) | null = null;

    headers.slice(0, -1).forEach((header, index) => {
        const handle = header.querySelector<HTMLElement>(".esj-history-column-resizer");
        if (!handle || !columns[index] || !columns[index + 1]) {
            return;
        }
        const onMouseDown = (event: MouseEvent) => {
            if (event.button !== 0) {
                return;
            }
            const tableWidth = table.getBoundingClientRect().width;
            const columnWidths = headers.map((cell) => cell.getBoundingClientRect().width);
            const leftStartWidth = columnWidths[index];
            const rightStartWidth = columnWidths[index + 1];
            if (tableWidth <= 0 || leftStartWidth <= 0 || rightStartWidth <= 0) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            finishActiveResize?.();
            columnWidths.forEach((width, columnIndex) => {
                columns[columnIndex].style.width = `${(width / tableWidth) * 100}%`;
            });

            const startX = event.clientX;
            const pairMinimumWidth = Math.min(HISTORY_MIN_COLUMN_WIDTH, (leftStartWidth + rightStartWidth) / 2);
            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            const onMouseMove = (moveEvent: MouseEvent) => {
                const requestedDelta = moveEvent.clientX - startX;
                const boundedDelta = Math.min(
                    Math.max(requestedDelta, pairMinimumWidth - leftStartWidth),
                    rightStartWidth - pairMinimumWidth
                );
                columns[index].style.width = `${((leftStartWidth + boundedDelta) / tableWidth) * 100}%`;
                columns[index + 1].style.width = `${((rightStartWidth - boundedDelta) / tableWidth) * 100}%`;
            };
            const finish = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", finish);
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                if (finishActiveResize === finish) {
                    finishActiveResize = null;
                }
            };
            finishActiveResize = finish;
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", finish);
        };
        handle.addEventListener("mousedown", onMouseDown);
        listeners.push({ handle, onMouseDown });
    });

    return () => {
        finishActiveResize?.();
        listeners.forEach(({ handle, onMouseDown }) => handle.removeEventListener("mousedown", onMouseDown));
    };
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
    if (item.selection?.mode === "range") {
        return t(item.chapterSummary.missingCount > 0 ? "history.chapter.rangeWithMissing" : "history.chapter.range", {
            start: item.selection.startChapter,
            end: item.selection.endChapter,
            total: item.chapterSummary.totalCount,
            missing: item.chapterSummary.missingCount
        });
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
    disposeActiveHistoryColumnResize?.();
    disposeActiveHistoryColumnResize = null;
    document.querySelector("#esj-download-history")?.remove();
    document.querySelector("#esj-download-history-confirm")?.remove();
    let disposeHistoryColumnResize: (() => void) | null = null;
    const close = () => {
        disposeActiveHistoryLocaleRefresh?.();
        disposeHistoryColumnResize?.();
        if (disposeActiveHistoryColumnResize === disposeHistoryColumnResize) {
            disposeActiveHistoryColumnResize = null;
        }
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
            ["range", t("history.filter.range")],
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
    const columnDefinitions: Array<[Parameters<typeof t>[0], string]> = [
        ["history.column.book", "21%"],
        ["history.column.author", "12%"],
        ["history.column.type", "9%"],
        ["history.column.format", "8%"],
        ["history.column.source", "8%"],
        ["history.column.chapter", "14%"],
        ["history.column.image", "9%"],
        ["history.column.time", "12%"],
        ["history.column.action", "7%"]
    ];
    const table = el("table", { style: "width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;" }, [
        el(
            "colgroup",
            {},
            columnDefinitions.map(([, width]) => el("col", { style: `width:${width};` }))
        ),
        el("thead", { style: "position:sticky;top:0;background:#f7f7f7;z-index:1;" }, [
            el(
                "tr",
                {},
                columnDefinitions.map(([key], index) =>
                    el(
                        "th",
                        {
                            style: `position:relative;padding:10px 8px;text-align:${index === 8 ? "center" : "left"};border-bottom:1px solid #ddd;white-space:nowrap;`
                        },
                        [
                            el("span", { className: "esj-history-column-label" }, [t(key)]),
                            ...(index < columnDefinitions.length - 1
                                ? [
                                      el("span", {
                                          className: "esj-history-column-resizer",
                                          "aria-hidden": "true",
                                          style: "position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;z-index:2;background:linear-gradient(to right,transparent 3px,#ccc 3px,#ccc 4px,transparent 4px);"
                                      })
                                  ]
                                : [])
                        ]
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
                    (scope === "single"
                        ? item.sourcePageType === "single"
                        : scope === "range"
                          ? item.selection?.mode === "range"
                          : item.sourcePageType !== "single" && item.selection?.mode !== "range")) &&
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
                [t("history.action.deleteShort")]
            );
            tableBody.appendChild(
                el("tr", {}, [
                    cell(item.bookName),
                    cell(item.author || "—"),
                    cell(
                        t(
                            item.sourcePageType === "single"
                                ? "history.type.single"
                                : item.selection?.mode === "range"
                                  ? "history.type.range"
                                  : "history.type.book"
                        )
                    ),
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
    disposeHistoryColumnResize = enableHistoryColumnResize(table);
    disposeActiveHistoryColumnResize = disposeHistoryColumnResize;
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
            ["range", "history.filter.range"],
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
        table.querySelectorAll<HTMLElement>(".esj-history-column-label").forEach((label, index) => {
            const key = columnDefinitions[index]?.[0];
            if (key) {
                label.textContent = t(key);
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
