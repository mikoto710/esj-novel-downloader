import type { DownloadSelection, DownloadTask } from "../core/download/contracts";
import { createRangeSelection } from "../core/download/selection";
import { enableDrag, el } from "../utils/dom";
import { createCommonHeader } from "./popup-components";
import { subscribeInterfaceLocaleChange, t } from "./locale";

export type RangeSelectionDecision =
    | { action: "download"; selection: DownloadSelection }
    | { action: "open-existing" }
    | { action: "cancel" };

export interface RangeSelectionPopupOptions {
    tasks: readonly DownloadTask[];
    cachedIndexes: ReadonlySet<number>;
    cacheWillBeInvalidated: boolean;
    hasExistingRange: boolean;
}

function togglePageActions(disabled: boolean): void {
    document.querySelectorAll(".esj-download-trigger,.esj-settings-trigger").forEach((element) => {
        (element as HTMLButtonElement).disabled = disabled;
    });
}

/**
 * 显示连续章节范围选择弹窗；缓存命中仅为锁前预览
 */
export function createRangeSelectionPopup(options: RangeSelectionPopupOptions): Promise<RangeSelectionDecision> {
    document.querySelector("#esj-range-selection")?.remove();
    togglePageActions(true);

    return new Promise((resolve) => {
        const total = options.tasks.length;
        let settled = false;
        let unsubscribeLocale: () => void = () => undefined;
        const finish = (decision: RangeSelectionDecision) => {
            if (settled) {
                return;
            }
            settled = true;
            unsubscribeLocale();
            popup.remove();
            togglePageActions(false);
            resolve(decision);
        };
        const header = createCommonHeader(t("range.title"), () => finish({ action: "cancel" }));
        const startLabel = el(
            "label",
            { for: "esj-range-start", style: "display:flex;flex-direction:column;gap:5px;" },
            [t("range.start")]
        );
        const endLabel = el("label", { for: "esj-range-end", style: "display:flex;flex-direction:column;gap:5px;" }, [
            t("range.end")
        ]);
        const startInput = el("input", {
            id: "esj-range-start",
            type: "number",
            min: 1,
            max: total,
            step: 1,
            value: 1,
            style: "padding:8px;border:1px solid #bbb;border-radius:5px;"
        });
        const endInput = el("input", {
            id: "esj-range-end",
            type: "number",
            min: 1,
            max: total,
            step: 1,
            value: total,
            style: "padding:8px;border:1px solid #bbb;border-radius:5px;"
        });
        startLabel.appendChild(startInput);
        endLabel.appendChild(endInput);

        const startTitle = el("div", { id: "esj-range-start-title", style: "font-size:12px;color:#666;" });
        const endTitle = el("div", { id: "esj-range-end-title", style: "font-size:12px;color:#666;" });
        const summary = el("div", { id: "esj-range-summary", style: "font-size:13px;color:#333;" });
        const validation = el("div", {
            id: "esj-range-validation",
            style: "font-size:12px;color:#b42318;min-height:18px;"
        });
        const allWarning = el("div", {
            id: "esj-range-all-warning",
            style: "display:none;padding:8px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:5px;font-size:12px;"
        });
        const cacheWarning = options.cacheWillBeInvalidated
            ? el(
                  "div",
                  {
                      id: "esj-range-cache-warning",
                      style: "padding:8px;border:1px solid #d97706;background:#fff7e6;color:#8a5a00;border-radius:5px;font-size:12px;"
                  },
                  [t("range.cacheDiscardWarning")]
              )
            : "";
        const stopWarning = el(
            "div",
            {
                id: "esj-range-stop-warning",
                style: "padding:8px;background:#f5f5f5;color:#555;border-radius:5px;font-size:12px;"
            },
            [t("range.stopClearWarning")]
        );
        const cancelButton = el(
            "button",
            {
                id: "esj-range-cancel",
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: () => finish({ action: "cancel" })
            },
            [t("common.cancel")]
        );
        const openPreviousButton = options.hasExistingRange
            ? el(
                  "button",
                  {
                      id: "esj-range-open-previous",
                      style: "padding:8px 12px;background:#fff;border:1px solid #2b9bd7;color:#2b6f9f;border-radius:6px;cursor:pointer;",
                      onclick: () => finish({ action: "open-existing" })
                  },
                  [t("range.openPrevious")]
              )
            : null;
        const downloadButton = el(
            "button",
            {
                id: "esj-range-download",
                style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;"
            },
            [t("range.download")]
        );

        const getSelection = (): DownloadSelection | null => {
            const startText = startInput.value.trim();
            const endText = endInput.value.trim();
            if (!startText || !endText) {
                return null;
            }
            try {
                return createRangeSelection(Number(startText), Number(endText), total);
            } catch {
                return null;
            }
        };
        const refresh = () => {
            const selection = getSelection();
            const headerLabel = header.querySelector("span");
            if (headerLabel) {
                headerLabel.textContent = t("range.title");
            }
            startLabel.firstChild!.textContent = t("range.start");
            endLabel.firstChild!.textContent = t("range.end");
            cancelButton.textContent = t("common.cancel");
            downloadButton.textContent = t("range.download");
            if (openPreviousButton) {
                openPreviousButton.textContent = t("range.openPrevious");
            }
            stopWarning.textContent = t("range.stopClearWarning");
            if (cacheWarning instanceof HTMLElement) {
                cacheWarning.textContent = t("range.cacheDiscardWarning");
            }
            if (!selection) {
                validation.textContent = t("range.invalid", { total });
                startTitle.textContent = "";
                endTitle.textContent = "";
                summary.textContent = "";
                allWarning.style.display = "none";
                downloadButton.disabled = true;
                return;
            }
            const selectedTasks = options.tasks.slice(selection.startIndex, selection.endIndex + 1);
            const cached = selectedTasks.reduce(
                (count, task) => count + (options.cachedIndexes.has(task.index) ? 1 : 0),
                0
            );
            validation.textContent = "";
            startTitle.textContent = t("range.startTitle", { title: selectedTasks[0]?.title || "" });
            endTitle.textContent = t("range.endTitle", { title: selectedTasks.at(-1)?.title || "" });
            summary.textContent = t("range.summary", { count: selectedTasks.length, cached });
            allWarning.textContent = t("range.allEquivalent");
            allWarning.style.display = selection.mode === "all" ? "block" : "none";
            downloadButton.disabled = false;
        };
        downloadButton.addEventListener("click", () => {
            const selection = getSelection();
            if (selection) {
                finish({ action: "download", selection });
            }
        });
        startInput.addEventListener("input", refresh);
        endInput.addEventListener("input", refresh);

        const popup = el(
            "div",
            {
                id: "esj-range-selection",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:470px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;display:flex;flex-direction:column;"
            },
            [
                header,
                el("div", { style: "padding:16px;display:flex;flex-direction:column;gap:10px;" }, [
                    el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;" }, [
                        startLabel,
                        endLabel
                    ]),
                    startTitle,
                    endTitle,
                    summary,
                    validation,
                    allWarning,
                    cacheWarning,
                    stopWarning
                ]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;" }, [
                    cancelButton,
                    ...(openPreviousButton ? [openPreviousButton] : []),
                    downloadButton
                ])
            ]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        unsubscribeLocale = subscribeInterfaceLocaleChange(refresh);
        refresh();
        startInput.focus();
        startInput.select();
    });
}

/**
 * 全本入口遇到范围导出快照时要求用户明确确认替换意图
 */
export function confirmReplaceRangeExport(): Promise<boolean> {
    document.querySelector("#esj-range-replace-confirm")?.remove();
    return new Promise((resolve) => {
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
                id: "esj-range-replace-confirm",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000000;display:flex;flex-direction:column;"
            },
            [
                createCommonHeader(t("range.replace.title"), () => finish(false)),
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;" }, [t("range.replace.message")]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
                    el(
                        "button",
                        {
                            id: "esj-range-replace-cancel",
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: () => finish(false)
                        },
                        [t("common.cancel")]
                    ),
                    el(
                        "button",
                        {
                            id: "esj-range-replace-continue",
                            style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;",
                            onclick: () => finish(true)
                        },
                        [t("range.replace.continue")]
                    )
                ])
            ]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-range-replace-cancel") as HTMLButtonElement | null)?.focus();
    });
}
