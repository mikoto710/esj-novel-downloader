import { isPartialSelectionSummary } from "../messages/selection";
import {
    clearDownloadHistory,
    DOWNLOAD_HISTORY_LIMIT,
    listDownloadHistory,
    removeDownloadHistory
} from "../../storage/history";
import type { DownloadFormat } from "../../export/filename";
import type { DownloadHistoryItem } from "../../storage/history";
import { el, enableDrag, registerElementCleanup, removeElement } from "../dom";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";
import { showDecisionDialog } from "./common";
import { createDownloadHistoryTable } from "./download-history-table";
import { showMessagePopup } from "./message";

let disposeActiveHistoryPopup: (() => void) | null = null;

function selectOptions(values: Array<[string, string]>): HTMLElement[] {
    return values.map(([value, text]) => el("option", { value }, [text]));
}

// 确认清空全部下载记录，关闭视为取消
function showHistoryClearConfirm(owner: HTMLElement): Promise<boolean> {
    return showDecisionDialog({ dismissed: false, owner }, (finish) => {
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
                        onclick: () => finish(false)
                    },
                    ["✕"]
                )
            ]
        );
        const cancelButton = el(
            "button",
            {
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: () => finish(false)
            },
            [t("common.cancel")]
        );
        const confirmButton = el(
            "button",
            {
                style: "padding:8px 12px;background:#d9534f;color:#fff;border:none;border-radius:6px;cursor:pointer;",
                onclick: () => finish(true)
            },
            [t("history.action.clear")]
        );
        return el(
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
    });
}

/**
 * 创建下载记录弹窗
 */
export function createDownloadHistoryPopup(): void {
    removeElement(document.querySelector("#esj-download-history"));
    disposeActiveHistoryPopup?.();
    let disposeLocaleRefresh: () => void = () => undefined;
    let disposed = false;

    function dispose(): void {
        if (disposed) {
            return;
        }
        disposed = true;
        disposeLocaleRefresh();
        historyTable.dispose();
        if (disposeActiveHistoryPopup === dispose) {
            disposeActiveHistoryPopup = null;
        }
    }

    const close = () => {
        removeElement(popup);
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

    // 三个筛选器只改变当前展示，记录本身仍保留在完整列表中
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
    const historyTable = createDownloadHistoryTable((id) => refreshAfterDeletion(removeDownloadHistory(id)));
    const listBox = el("div", { style: "flex:1;min-height:0;overflow:auto;padding:0 16px 16px;" }, [
        historyTable.element
    ]);
    let items: DownloadHistoryItem[] = [];

    async function refreshHistory(): Promise<void> {
        items = await listDownloadHistory();
        render();
    }

    async function refreshAfterDeletion(deletion: Promise<void>): Promise<void> {
        try {
            await deletion;
        } catch (error) {
            if (popup.isConnected) {
                showMessagePopup({
                    tone: "error",
                    message: t("history.deleteFailed"),
                    details: error instanceof Error ? error.message : String(error)
                });
            }
            return;
        }
        await refreshHistory();
    }

    async function clearHistory(): Promise<void> {
        const confirmed = await showHistoryClearConfirm(popup);
        if (!confirmed) {
            return;
        }
        await refreshAfterDeletion(clearDownloadHistory());
    }

    // 按导出范围、格式和来源筛选并重建记录列表
    function render(): void {
        const scope = (scopeSelect as HTMLSelectElement).value;
        const format = (formatSelect as HTMLSelectElement).value as "all" | DownloadFormat;
        const source = (sourceSelect as HTMLSelectElement).value;
        const filtered = items.filter(
            (item) =>
                (scope === "all" ||
                    (scope === "single"
                        ? item.sourcePageType === "single"
                        : scope === "range"
                          ? isPartialSelectionSummary(item.selection)
                          : item.sourcePageType !== "single" && !isPartialSelectionSummary(item.selection))) &&
                (format === "all" || item.format === format) &&
                (source === "all" || item.sourcePageType === source)
        );
        summary.textContent = t("history.summary", {
            shown: filtered.length,
            total: items.length,
            limit: DOWNLOAD_HISTORY_LIMIT
        });

        historyTable.render(filtered);
    }

    [scopeSelect, formatSelect, sourceSelect].forEach((select) => select.addEventListener("change", render));

    // 底部清空作用于全部历史，不受当前筛选条件限制
    const clearButton = el(
        "button",
        {
            id: "esj-history-clear",
            style: "padding:8px 12px;background:#d9534f;color:#fff;border:0;border-radius:6px;cursor:pointer;",
            onclick: clearHistory
        },
        [t("history.action.clearAll")]
    );
    const refreshButton = el(
        "button",
        {
            id: "esj-history-refresh",
            style: "padding:8px 12px;background:#f5f5f5;color:#333;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
            onclick: refreshHistory
        },
        [t("cache.action.refresh")]
    );

    const filters = el("div", { style: "padding:14px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;" }, [
        scopeSelect,
        formatSelect,
        sourceSelect,
        summary
    ]);
    const closeButton = el(
        "button",
        {
            id: "esj-history-close",
            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
            onclick: close
        },
        [t("common.close")]
    );
    const actions = el(
        "div",
        { style: "padding:12px 16px;border-top:1px solid #eee;display:flex;justify-content:space-between;" },
        [el("div", { style: "display:flex;gap:8px;" }, [refreshButton, clearButton]), closeButton]
    );

    // 筛选栏和底部操作固定，长记录列表在中间区域滚动
    const popup = el(
        "div",
        {
            id: "esj-download-history",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(960px,calc(100vw - 32px));height:min(640px,calc(100vh - 32px));background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;display:flex;flex-direction:column;"
        },
        [header, filters, listBox, actions]
    );
    document.body.appendChild(popup);
    registerElementCleanup(popup, dispose);
    acquirePageActionGroupLockForPopup(popup);
    enableDrag(popup, ".esj-common-header");
    disposeActiveHistoryPopup = dispose;

    // 语言切换重绘文字和记录行，保留当前列表滚动位置
    function refreshLocaleText(): void {
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
        historyTable.refreshLocale();
        clearButton.textContent = t("history.action.clearAll");
        refreshButton.textContent = t("cache.action.refresh");
        closeButton.textContent = t("common.close");
        render();
        listBox.scrollTop = listScrollTop;
    }

    function onLocaleChange(): void {
        if (!popup.isConnected) {
            dispose();
            return;
        }
        refreshLocaleText();
    }

    disposeLocaleRefresh = subscribeInterfaceLocaleChange(onLocaleChange);
    void refreshHistory();
}
