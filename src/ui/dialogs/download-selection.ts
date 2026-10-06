import type { DownloadSelection, DownloadSelectionSummary } from "../../download/plan";
import type { LocaleKey } from "../../locale/catalog";
import type { DownloadTask } from "../../download/contracts";
import {
    createDownloadPlan,
    createDownloadSelectionSummary,
    createRangeSelection,
    selectDownloadTasks
} from "../../download/plan";
import { enableDrag, el, registerElementCleanup, removeElement } from "../dom";
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
        const initialSummary = options.initialSelection
            ? createDownloadSelectionSummary(options.initialSelection)
            : undefined;
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

        // 切换方式只收起范围输入，保留已填写的章序
        const allMode = el("input", {
            id: "esj-download-all",
            type: "radio",
            name: "esj-download-mode",
            value: "all",
            checked: options.initialSelection?.mode !== "range"
        });
        const rangeMode = el("input", {
            id: "esj-download-range",
            type: "radio",
            name: "esj-download-mode",
            value: "range",
            checked: options.initialSelection?.mode === "range"
        });
        const allModeText = el("span");
        const rangeModeText = el("span");
        const mode = el(
            "div",
            {
                id: "esj-download-mode",
                role: "radiogroup",
                style: "display:flex;gap:20px;flex-wrap:wrap;"
            },
            [
                el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;" }, [
                    allMode,
                    allModeText
                ]),
                el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;" }, [
                    rangeMode,
                    rangeModeText
                ])
            ]
        );
        const imageLabel = el("span");
        const imageStatus = el("span", { style: `color:${options.imageEnabled ? "#237eaf" : "#666"};` });
        const imageSetting = el("div", { id: "esj-download-images", style: "font-size:13px;color:#666;" }, [
            el("span", { "aria-hidden": "true" }, ["🖼️ "]),
            imageLabel,
            imageStatus
        ]);
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
            value: initialSummary?.startChapter ?? 1,
            style: "width:100%;min-width:0;height:32px;padding:4px 8px;background:#fff;color:#333;border:1px solid #bbb;border-radius:4px;"
        });
        const endInput = el("input", {
            id: "esj-range-end",
            type: "number",
            min: 1,
            max: total,
            step: 1,
            value: initialSummary?.endChapter ?? total,
            style: "width:100%;min-width:0;height:32px;padding:4px 8px;background:#fff;color:#333;border:1px solid #bbb;border-radius:4px;"
        });
        startLabel.appendChild(startInput);
        endLabel.appendChild(endInput);

        // 章名、数量和校验结果随输入刷新，不在输入时重新读取缓存
        const startTitle = el("div", {
            id: "esj-range-start-title",
            style: "font-size:12px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        });
        const endTitle = el("div", {
            id: "esj-range-end-title",
            style: "font-size:12px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        });
        const rangeFields = el(
            "div",
            { id: "esj-range-fields", style: "display:none;flex-direction:column;gap:6px;" },
            [
                el("div", { style: "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;" }, [
                    startLabel,
                    endLabel
                ]),
                el("div", { style: "display:flex;flex-direction:column;gap:2px;" }, [startTitle, endTitle])
            ]
        );
        // 章数、插图和缓存各占一行，只强调状态与可复用数量
        const chapterCount = el("div");
        const cacheLabel = el("span");
        const cacheReuseText = el("span");
        const cacheReuseCount = el("strong", { style: "font-weight:600;color:#444;" });
        const cacheReuseUnit = el("span");
        const cacheReuse = el("div", { id: "esj-range-cache-reuse", style: "font-size:13px;color:#666;" }, [
            el("span", { "aria-hidden": "true" }, ["♻️ "]),
            cacheLabel,
            cacheReuseText,
            " ",
            cacheReuseCount,
            " ",
            cacheReuseUnit
        ]);
        const summary = el("div", { id: "esj-range-summary", style: "display:flex;flex-direction:column;gap:5px;" }, [
            chapterCount,
            imageSetting,
            cacheReuse
        ]);
        const validation = el("div", {
            id: "esj-range-validation",
            style: "display:none;font-size:12px;color:#b42318;"
        });

        // 全范围只作轻提示，整书缓存失效才突出警告
        const allWarning = el("div", {
            id: "esj-range-all-warning",
            style: "display:none;color:#666;font-size:12px;"
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
        const cancelButton = el(
            "button",
            {
                id: "esj-range-cancel",
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: () => finish({ action: "cancel" })
            },
            [t("common.cancel")]
        );

        // 旧结果可独立导出，目录或缓存预检失败时仍保留这个入口
        const openPreviousButton = options.hasExistingExport
            ? el(
                  "button",
                  {
                      id: "esj-range-open-previous",
                      style: "padding:8px 12px;background:#f3f8fc;border:1px solid #b8d5e8;border-radius:6px;color:#2b6f9f;cursor:pointer;white-space:nowrap;",
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
            if (allMode.checked) {
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
            startInput.disabled = endInput.disabled = allMode.checked;
            rangeFields.style.display = rangeMode.checked ? "flex" : "none";
            allModeText.textContent = t("range.modeAll");
            rangeModeText.textContent = t("range.modeRange");
            mode.setAttribute("aria-label", t("range.title"));
            imageLabel.textContent = t("range.imagesLabel");
            imageStatus.textContent = t(options.imageEnabled ? "range.imagesEnabled" : "range.imagesDisabled");
            cacheLabel.textContent = t("range.cacheLabel");
            cacheReuseText.textContent = t("range.summary");
            cacheReuseUnit.textContent = t("range.cacheUnit");
            const headerLabel = header.querySelector("span");
            if (headerLabel) {
                headerLabel.textContent = t("range.title");
            }
            startLabel.firstChild!.textContent = t("range.start");
            endLabel.firstChild!.textContent = t("range.end");
            cancelButton.textContent = t("common.cancel");
            downloadButton.textContent = t(
                options.cacheWillBeInvalidated ? "range.clearAndDownload" : "range.download"
            );
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
                openPreviousButton.textContent = t("range.openPrevious");
                openPreviousButton.title = `${t("range.openPrevious")}（${label}）`;
                openPreviousButton.setAttribute("aria-label", openPreviousButton.title);
            }
            if (cacheWarning instanceof HTMLElement) {
                cacheWarning.textContent = t("range.cacheDiscardWarning", { count: options.cacheCount });
            }
            if (!selection) {
                validation.textContent = options.preparationErrorKey
                    ? t(options.preparationErrorKey)
                    : t("range.invalid", { total });
                startTitle.textContent = "";
                endTitle.textContent = "";
                summary.style.display = "none";
                validation.style.display = "block";
                allWarning.style.display = "none";
                downloadButton.disabled = true;
                return;
            }
            const plan = createDownloadPlan({ tasks: selectDownloadTasks(options.tasks, selection), selection });
            const selectedTasks = plan.tasks;

            // 不兼容的库存会整书失效，不能计入本次可复用数量
            const cached = options.cacheWillBeInvalidated ? 0 : plan.readyCount(options.cachedIndexes);
            validation.textContent = "";
            validation.style.display = "none";
            summary.style.display = "flex";
            startTitle.textContent = t("range.startTitle", { title: selectedTasks[0]?.title || "" });
            endTitle.textContent = t("range.endTitle", { title: selectedTasks.at(-1)?.title || "" });
            startTitle.title = startTitle.textContent;
            endTitle.title = endTitle.textContent;
            chapterCount.textContent = t("range.chapterCount", { count: selectedTasks.length });
            cacheReuseCount.textContent = String(cached);
            cacheReuse.style.display = options.cacheWillBeInvalidated ? "none" : "block";
            allWarning.textContent = t("range.allEquivalent");
            allWarning.style.display = rangeMode.checked && selection.mode === "all" ? "block" : "none";
            downloadButton.disabled = false;
        };
        downloadButton.addEventListener("click", () => {
            const selection = getSelection();
            if (selection) {
                finish({ action: "download", selection });
            }
        });
        allMode.addEventListener("change", refresh);
        rangeMode.addEventListener("change", refresh);
        startInput.addEventListener("input", refresh);
        endInput.addEventListener("input", refresh);

        // 正文排列选择、预览和警告，底部只负责返回本次操作决策
        const popup = el(
            "div",
            {
                id: "esj-range-selection",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:400px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);font:14px/1.5 sans-serif;color:#333;text-align:left;box-sizing:border-box;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;display:flex;flex-direction:column;"
            },
            [
                // 控件字号和间距限定在本弹窗内，避免继承站点的大号表单样式
                el("style", {}, [
                    `
                    #esj-range-selection button, #esj-range-selection input {
                        font: inherit; line-height: 1.5; box-sizing: border-box; margin: 0; min-height: 0;
                    }
                    #esj-range-selection button { width: auto; text-transform: none; }
                    #esj-range-selection button:disabled { opacity: .55; cursor: not-allowed; }
                    #esj-range-selection label { margin: 0; font: inherit; color: inherit; }
                    #esj-download-mode input { appearance: auto; width: 14px; height: 14px; padding: 0; flex: 0 0 auto; }
                    #esj-range-selection .esj-common-header { font-size: 16px; flex-shrink: 0; }
                `
                ]),
                header,
                el(
                    "div",
                    { style: "padding:16px;display:flex;flex-direction:column;gap:12px;overflow:auto;min-height:0;" },
                    [mode, rangeFields, summary, validation, allWarning, cacheWarning]
                ),

                // 旧结果入口靠左，取消和开始下载作为一组靠右
                el(
                    "div",
                    {
                        style: "padding:0 16px 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;"
                    },
                    [
                        ...(openPreviousButton ? [openPreviousButton] : []),
                        el("div", { style: "margin-left:auto;display:flex;justify-content:flex-end;gap:8px;" }, [
                            cancelButton,
                            downloadButton
                        ])
                    ]
                )
            ]
        );
        document.body.appendChild(popup);
        registerElementCleanup(popup, () => finish({ action: "cancel" }));
        acquirePageActionGroupLockForPopup(popup);
        enableDrag(popup, ".esj-common-header");
        unsubscribeLocale = subscribeInterfaceLocaleChange(refresh);
        refresh();
        (options.preparationErrorKey && openPreviousButton
            ? openPreviousButton
            : rangeMode.checked
              ? rangeMode
              : allMode
        ).focus();
    });
}
