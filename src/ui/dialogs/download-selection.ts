import type { DownloadSelectionSummary } from "../../types";
import type { LocaleKey } from "../../core/locale";
import type { DownloadSelection, DownloadTask } from "../../core/download/contracts";
import { createRangeSelection } from "../../core/download/selection";
import { enableDrag, el, registerElementCleanup, removeElement } from "../../utils/dom";
import { createCommonHeader } from "./common";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";

export type DownloadSelectionDecision =
    | { action: "download"; selection: DownloadSelection }
    | { action: "open-existing" }
    | { action: "cancel" };

export interface DownloadSelectionPopupOptions {
    tasks: readonly DownloadTask[];
    cachedIndexes: ReadonlySet<number>;
    cacheWillBeInvalidated: boolean;
    hasExistingExport: boolean;
    cacheCount: number;
    imageEnabled: boolean;
    existingSelection?: DownloadSelectionSummary;
    initialSelection?: DownloadSelection;
    preparationErrorKey?: LocaleKey;
}

let finishActiveRangeSelection: ((decision: DownloadSelectionDecision) => void) | null = null;

/**
 * 选择全本或连续范围，缓存命中仅作锁前预览
 */
export function createDownloadSelectionPopup(
    options: DownloadSelectionPopupOptions
): Promise<DownloadSelectionDecision> {
    finishActiveRangeSelection?.({ action: "cancel" });
    removeElement(document.querySelector("#esj-range-selection"));

    return new Promise((resolve) => {
        const total = options.tasks.length;
        let settled = false;
        let unsubscribeLocale: () => void = () => undefined;
        // 关闭按钮、替换弹窗和外部移除共用同一次决策收尾
        const finish = (decision: DownloadSelectionDecision) => {
            if (settled) {
                return;
            }
            settled = true;
            if (finishActiveRangeSelection === finish) {
                finishActiveRangeSelection = null;
            }
            unsubscribeLocale();
            removeElement(popup);
            resolve(decision);
        };
        finishActiveRangeSelection = finish;
        const header = createCommonHeader(t("range.title"), () => finish({ action: "cancel" }));
        const mode = el(
            "select",
            { id: "esj-download-mode", style: "padding:8px;border:1px solid #bbb;border-radius:5px;" },
            [
                el("option", { value: "all" }, [t("range.modeAll")]),
                el("option", { value: "range" }, [t("range.modeRange")])
            ]
        );
        mode.value = options.initialSelection?.mode || "all";
        const imageSetting = el("div", { id: "esj-download-images", style: "font-size:12px;color:#666;" });
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
            value: (options.initialSelection?.startIndex ?? 0) + 1,
            style: "padding:8px;border:1px solid #bbb;border-radius:5px;"
        });
        const endInput = el("input", {
            id: "esj-range-end",
            type: "number",
            min: 1,
            max: total,
            step: 1,
            value: (options.initialSelection?.endIndex ?? total - 1) + 1,
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
                  [t("range.cacheDiscardWarning", { count: options.cacheCount })]
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
        const openPreviousButton = options.hasExistingExport
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
            if (options.preparationErrorKey || total === 0) {
                return null;
            }
            if (mode.value === "all") {
                return createRangeSelection(1, total, total);
            }
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
        // 只刷新文案和预览，切换语言时保留用户输入
        const refresh = () => {
            const selection = getSelection();
            startInput.disabled = endInput.disabled = mode.value === "all";
            mode.options[0].textContent = t("range.modeAll");
            mode.options[1].textContent = t("range.modeRange");
            imageSetting.textContent = t(options.imageEnabled ? "range.imagesEnabled" : "range.imagesDisabled");
            const headerLabel = header.querySelector("span");
            if (headerLabel) {
                headerLabel.textContent = t("range.title");
            }
            startLabel.firstChild!.textContent = t("range.start");
            endLabel.firstChild!.textContent = t("range.end");
            cancelButton.textContent = t("common.cancel");
            downloadButton.textContent = t("range.download");
            if (openPreviousButton) {
                const previous = options.existingSelection;
                const label =
                    previous?.mode === "range"
                        ? t("export.range", {
                              start: previous.startChapter,
                              end: previous.endChapter,
                              count: previous.endChapter - previous.startChapter + 1
                          })
                        : t("range.modeAll");
                openPreviousButton.textContent = `${t("range.openPrevious")}（${label}）`;
            }
            stopWarning.textContent = t("range.stopClearWarning");
            if (cacheWarning instanceof HTMLElement) {
                cacheWarning.textContent = t("range.cacheDiscardWarning", { count: options.cacheCount });
            }
            if (!selection) {
                validation.textContent = options.preparationErrorKey
                    ? t(options.preparationErrorKey)
                    : t("range.invalid", { total });
                startTitle.textContent = "";
                endTitle.textContent = "";
                summary.textContent = "";
                allWarning.style.display = "none";
                downloadButton.disabled = true;
                return;
            }
            const selectedTasks = options.tasks.slice(selection.startIndex, selection.endIndex + 1);
            // 不兼容的库存会整书失效，不能计入本次可复用数量
            const cached = selectedTasks.reduce(
                (count, task) =>
                    count + (!options.cacheWillBeInvalidated && options.cachedIndexes.has(task.index) ? 1 : 0),
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
        mode.addEventListener("change", refresh);
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
                    mode,
                    imageSetting,
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
        registerElementCleanup(popup, () => finish({ action: "cancel" }));
        acquirePageActionGroupLockForPopup(popup);
        enableDrag(popup, ".esj-common-header");
        unsubscribeLocale = subscribeInterfaceLocaleChange(refresh);
        refresh();
        (options.preparationErrorKey && openPreviousButton ? openPreviousButton : mode).focus();
    });
}
