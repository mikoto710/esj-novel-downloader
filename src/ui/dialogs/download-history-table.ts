import type { SourcePageType } from "../../content/model";
import type { DownloadHistoryItem } from "../../storage/history";
import { el } from "../dom";
import { t } from "../locale";
import { formatSelectionSummary, isPartialSelectionSummary } from "../messages/selection";

interface DownloadHistoryTable {
    element: HTMLTableElement;
    /**
     * 只重建传入记录对应的表格正文，保留表头和列宽
     */
    render(items: readonly DownloadHistoryItem[]): void;
    /**
     * 原地更新列标题，记录行由调用方按当前筛选重新渲染
     */
    refreshLocale(): void;
    /**
     * 结束当前列拖拽并移除列宽调整监听
     */
    dispose(): void;
}

const HISTORY_MIN_COLUMN_WIDTH = 48;

// 同一列定义生成宽度和表头，最后一列不设置拖拽分隔柄
const HISTORY_COLUMNS: Array<[Parameters<typeof t>[0], string]> = [
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
    if (isPartialSelectionSummary(item.selection)) {
        return formatSelectionSummary(item.selection, item.chapterSummary?.missingCount);
    }
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

function createHistoryCell(text: string, title = text): HTMLTableCellElement {
    return el(
        "td",
        {
            title,
            style: "padding:10px 8px;border-bottom:1px solid #eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        },
        [text]
    );
}

function createHistoryRow(item: DownloadHistoryItem, onRemove: (id: string) => Promise<void>): HTMLElement {
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
            onclick: () => onRemove(item.id)
        },
        [t("history.action.deleteShort")]
    );

    // 单行依次展示书籍、导出信息、时间，操作区只作用于本条记录
    return el("tr", {}, [
        createHistoryCell(item.bookName),
        createHistoryCell(item.author || "—"),
        createHistoryCell(
            t(
                item.sourcePageType === "single"
                    ? "history.type.single"
                    : isPartialSelectionSummary(item.selection)
                      ? "history.type.range"
                      : "history.type.book"
            )
        ),
        createHistoryCell(item.format.toUpperCase()),
        createHistoryCell(sourceLabel(item.sourcePageType)),
        createHistoryCell(chapterStatusText(item)),
        createHistoryCell(imageStatusText(item)),
        createHistoryCell(formatTime(item.exportedAt)),
        el("td", { style: "padding:10px 8px;border-bottom:1px solid #eee;" }, [
            el(
                "div",
                {
                    style: "display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;"
                },
                [openButton, deleteButton]
            )
        ])
    ]);
}

// 调整相邻列宽，并返回拖拽监听的清理函数
function enableHistoryColumnResize(table: HTMLTableElement): () => void {
    const columns = Array.from(table.querySelectorAll<HTMLTableColElement>("col"));
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    const listeners: Array<{ handle: HTMLElement; onMouseDown: (event: MouseEvent) => void }> = [];
    let finishActiveResize: (() => void) | null = null;

    for (const [index, header] of headers.slice(0, -1).entries()) {
        const handle = header.querySelector<HTMLElement>(".esj-history-column-resizer");
        if (!handle || !columns[index] || !columns[index + 1]) {
            continue;
        }

        function startColumnResize(event: MouseEvent): void {
            if (event.button !== 0) {
                return;
            }

            // 表格挂载后开始拖拽时测量，创建表格不读取布局尺寸
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

            function resizeAdjacentColumns(moveEvent: MouseEvent): void {
                // 只在相邻两列间分配宽度，保持表格总宽和最小列宽
                const requestedDelta = moveEvent.clientX - startX;
                const boundedDelta = Math.min(
                    Math.max(requestedDelta, pairMinimumWidth - leftStartWidth),
                    rightStartWidth - pairMinimumWidth
                );
                columns[index].style.width = `${((leftStartWidth + boundedDelta) / tableWidth) * 100}%`;
                columns[index + 1].style.width = `${((rightStartWidth - boundedDelta) / tableWidth) * 100}%`;
            }

            function finish(): void {
                document.removeEventListener("mousemove", resizeAdjacentColumns);
                document.removeEventListener("mouseup", finish);
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                if (finishActiveResize === finish) {
                    finishActiveResize = null;
                }
            }

            finishActiveResize = finish;
            document.addEventListener("mousemove", resizeAdjacentColumns);
            document.addEventListener("mouseup", finish);
        }

        handle.addEventListener("mousedown", startColumnResize);
        listeners.push({ handle, onMouseDown: startColumnResize });
    }

    function dispose(): void {
        finishActiveResize?.();
        listeners.forEach(({ handle, onMouseDown }) => handle.removeEventListener("mousedown", onMouseDown));
    }

    return dispose;
}

function createColumnHeader([key]: [Parameters<typeof t>[0], string], index: number): HTMLTableCellElement {
    const children = [el("span", { className: "esj-history-column-label" }, [t(key)])];
    if (index < HISTORY_COLUMNS.length - 1) {
        children.push(
            el("span", {
                className: "esj-history-column-resizer",
                "aria-hidden": "true",
                style: "position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;z-index:2;background:linear-gradient(to right,transparent 3px,#ccc 3px,#ccc 4px,transparent 4px);"
            })
        );
    }
    return el(
        "th",
        {
            style: `position:relative;padding:10px 8px;text-align:${index === 8 ? "center" : "left"};border-bottom:1px solid #ddd;white-space:nowrap;`
        },
        children
    );
}

/**
 * 创建下载记录表格；行内删除只报告记录 ID，由外层处理存储和列表刷新
 */
export function createDownloadHistoryTable(onRemove: (id: string) => Promise<void>): DownloadHistoryTable {
    const tableBody = el("tbody");
    const columnGroup = el(
        "colgroup",
        {},
        HISTORY_COLUMNS.map(([, width]) => el("col", { style: `width:${width};` }))
    );
    const tableHeader = el("thead", { style: "position:sticky;top:0;background:#f7f7f7;z-index:1;" }, [
        el("tr", {}, HISTORY_COLUMNS.map(createColumnHeader))
    ]);
    const element = el("table", { style: "width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;" }, [
        columnGroup,
        tableHeader,
        tableBody
    ]);
    const disposeColumnResize = enableHistoryColumnResize(element);

    function render(items: readonly DownloadHistoryItem[]): void {
        // 只重建记录行，保留表头和用户调整后的列宽
        tableBody.replaceChildren();
        if (items.length === 0) {
            tableBody.appendChild(
                el("tr", {}, [
                    el("td", { colspan: 9, style: "padding:48px;text-align:center;color:#777;" }, [t("history.empty")])
                ])
            );
            return;
        }
        for (const item of items) {
            tableBody.appendChild(createHistoryRow(item, onRemove));
        }
    }

    function refreshLocale(): void {
        tableHeader.querySelectorAll<HTMLElement>(".esj-history-column-label").forEach((label, index) => {
            const key = HISTORY_COLUMNS[index]?.[0];
            if (key) {
                label.textContent = t(key);
            }
        });
    }

    return { element, render, refreshLocale, dispose: disposeColumnResize };
}
