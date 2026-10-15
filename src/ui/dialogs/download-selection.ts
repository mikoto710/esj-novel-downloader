import type { BookDirectorySnapshot } from "../../site/book-directory";
import type { DownloadSelection, DownloadSelectionInput, StoredDownloadSelectionSummary } from "../../download/plan";
import type { LocaleKey } from "../../locale/catalog";
import type { DownloadTask } from "../../download/contracts";
import {
    createChapterSelection,
    createDownloadPlan,
    createRangeSelection,
    selectDownloadTasks
} from "../../download/plan";
import { enableDrag, el, registerElementCleanup, removeElement } from "../dom";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";
import { formatSelectionSummary } from "../messages/selection";
import { createCommonHeader } from "./common";
import { createChapterDirectoryView, type ChapterDirectoryView } from "./chapter-directory";
import { createChapterSearchView } from "./chapter-search";
import { DOWNLOAD_SELECTION_STYLES } from "./download-selection-styles";

export type DownloadSelectionDecision =
    | { action: "download"; selection: DownloadSelectionInput }
    | { action: "open-existing" }
    | { action: "cancel" };

export type DownloadPreparationStage = "checking-task" | "reading-book" | "checking-cache";

/**
 * 固定目录与只读缓存预览，章节身份始终使用原书索引
 */
export interface DownloadSelectionPreview {
    directory?: BookDirectorySnapshot;
    bookTitle?: string;
    tasks: readonly DownloadTask[];
    cachedIndexes: ReadonlySet<number>;
    cacheWillBeInvalidated: boolean;
    cacheCount: number;
    initialSelection?: DownloadSelectionInput;
    preparationErrorKey?: LocaleKey;
}

/**
 * 选择窗口的初始输入，插图设置与旧导出入口在创建时固定
 */
export interface DownloadSelectionPopupOptions extends DownloadSelectionPreview {
    hasExistingExport: boolean;
    imageEnabled: boolean;
    existingSelection?: StoredDownloadSelectionSummary;
    preparationStage?: DownloadPreparationStage;
}

/**
 * 选择会话的决策与准备状态，结束后忽略晚到更新
 */
export interface DownloadSelectionPopup {
    decision: Promise<DownloadSelectionDecision>;
    readonly closed: boolean;
    showPreparing(stage: DownloadPreparationStage): void;
    showReady(preview: DownloadSelectionPreview): void;
    close(): void;
}

const PREPARATION_MESSAGES: Record<DownloadPreparationStage, LocaleKey> = {
    "checking-task": "range.preparingTask",
    "reading-book": "range.preparingBook",
    "checking-cache": "range.preparingCache"
};

let finishActiveSelection: ((decision: DownloadSelectionDecision) => void) | null = null;

/**
 * 统一从目录勾选固定章节集合；准备与勾选均不取得任务锁或写入缓存
 */
export function createDownloadSelectionPopup(options: DownloadSelectionPopupOptions): DownloadSelectionPopup {
    finishActiveSelection?.({ action: "cancel" });
    removeElement(document.querySelector("#esj-range-selection"));

    let resolveDecision!: (decision: DownloadSelectionDecision) => void;
    const decision = new Promise<DownloadSelectionDecision>((resolve) => {
        resolveDecision = resolve;
    });

    // 预览与勾选属于当前选择会话，切换下载方式时保留
    let preview: DownloadSelectionPreview = options;
    let stage = options.preparationStage;
    let settled = false;
    let unsubscribeLocale: () => void = () => undefined;
    let directoryView: ChapterDirectoryView | undefined;
    let selected = new Set<number>();

    const restoreSelection = (selection?: DownloadSelectionInput) => {
        selected = new Set(
            (selection ? selectDownloadTasks(preview.tasks, selection) : preview.tasks).map((task) => task.index)
        );
    };
    restoreSelection(options.initialSelection);

    // 所有关闭入口共用决策收尾，统一释放订阅与子视图
    const finish = (value: DownloadSelectionDecision) => {
        if (settled) {
            return;
        }

        settled = true;
        if (finishActiveSelection === finish) {
            finishActiveSelection = null;
        }
        unsubscribeLocale();
        searchView.dispose();
        directoryView?.dispose();
        removeElement(popup);
        resolveDecision(value);
    };
    const unavailable = () => Boolean(stage || preview.preparationErrorKey || !preview.tasks.length);

    // 下载方式
    const header = createCommonHeader(t("range.title"), () => finish({ action: "cancel" }));
    const allMode = el("input", {
        id: "esj-download-all",
        type: "radio",
        name: "esj-download-mode",
        value: "all",
        checked: !options.initialSelection || options.initialSelection.mode === "all"
    });
    const rangeMode = el("input", {
        id: "esj-download-range",
        type: "radio",
        name: "esj-download-mode",
        value: "selected",
        checked: Boolean(options.initialSelection && options.initialSelection.mode !== "all")
    });
    const allText = el("span"),
        selectedText = el("span");
    const mode = el("div", { role: "radiogroup", className: "esj-selection-modes" }, [
        el("label", {}, [allMode, allText]),
        el("label", {}, [rangeMode, selectedText])
    ]);

    const bookTitle = el("div", { className: "esj-selection-book-title" });
    const chapterCount = el("strong", { id: "esj-selection-count", "aria-live": "polite" });
    const totalCount = el("div", { className: "esj-selection-total" });

    // 搜索只跳转目录，批量勾选统一更新已选集合
    const directoryBox = el("div", { id: "esj-range-directory", className: "esj-selection-directory" });
    const searchView = createChapterSearchView({
        search: (query) => directoryView?.search(query) || [],
        getBounds: () => ({
            top: header.getBoundingClientRect().bottom + 4,
            bottom: footer.getBoundingClientRect().top - 4
        }),
        onNavigate(index) {
            if (!settled) {
                directoryView?.reveal(index);
            }
        }
    });

    const selectAll = el("button", {
        type: "button",
        onclick: () => {
            selected = new Set(preview.tasks.map((task) => task.index));
            refresh();
        }
    });
    const invertSelection = el("button", {
        type: "button",
        onclick: () => {
            selected = new Set(preview.tasks.filter((task) => !selected.has(task.index)).map((task) => task.index));
            refresh();
        }
    });
    const clearSelection = el("button", {
        id: "esj-range-clear-selection",
        type: "button",
        onclick: () => {
            selected.clear();
            refresh();
        }
    });

    const rangeFields = el("div", { id: "esj-range-fields", className: "esj-selection-fields" }, [
        searchView.element,
        el("div", { className: "esj-selection-toolbar" }, [selectAll, invertSelection, clearSelection]),
        directoryBox
    ]);

    // 插图和缓存提示保留图标与重点颜色；缓存失效同意仍由正式决策处理
    const imageValue = el("strong");
    const imageLabel = el("span");
    const imageStatus = el("div", { id: "esj-download-images" }, [
        el("span", { "aria-hidden": "true" }, ["🖼️ "]),
        imageLabel,
        imageValue
    ]);

    const cacheLabel = el("span"),
        cacheValue = el("strong"),
        cacheUnit = el("span");
    const cacheReuse = el("div", { id: "esj-range-cache-reuse" }, [
        el("span", { "aria-hidden": "true" }, ["♻️ "]),
        cacheLabel,
        cacheValue,
        cacheUnit
    ]);
    const summary = el("div", { className: "esj-selection-summary" }, [imageStatus, cacheReuse]);
    const validation = el("div", { id: "esj-range-validation", role: "status" });
    const cacheWarning = el("div", { className: "esj-selection-cache-warning" });

    // 旧结果入口放在书名信息区，准备中或准备失败时仍可用
    const previousButton = options.hasExistingExport
        ? el("button", {
              id: "esj-range-open-previous",
              type: "button",
              onclick: () => finish({ action: "open-existing" })
          })
        : null;
    const bookDetails = el("div", { className: "esj-selection-book-info" }, [bookTitle, summary]);
    const bookInfo = el("div", { className: "esj-selection-book" }, [
        bookDetails,
        ...(previousButton ? [previousButton] : [])
    ]);

    // 底栏只返回本次下载或取消决策，正式任务由调用方处理
    const cancelButton = el("button", {
        id: "esj-range-cancel",
        type: "button",
        onclick: () => finish({ action: "cancel" })
    });
    const downloadButton = el("button", {
        id: "esj-range-download",
        type: "button",
        className: "esj-selection-download",
        onclick: () => {
            const selection = getSelection();
            if (selection) {
                finish({ action: "download", selection });
            }
        }
    });

    const getSelection = (): DownloadSelection | null => {
        if (unavailable()) {
            return null;
        }
        return allMode.checked
            ? createRangeSelection(1, preview.tasks.length, preview.tasks.length)
            : selected.size
              ? createChapterSelection([...selected], preview.tasks.length)
              : null;
    };

    const refresh = () => {
        if (settled) {
            return;
        }

        const disabled = unavailable();
        allMode.disabled = rangeMode.disabled = disabled;
        allText.textContent = t("range.modeAll");
        selectedText.textContent = t("range.modeRange");
        mode.setAttribute("aria-label", t("selection.downloadMode"));
        header.querySelector("span")!.textContent = t("range.title");
        bookTitle.textContent = preview.bookTitle || "";
        bookTitle.hidden = !preview.bookTitle;
        bookDetails.hidden = !preview.bookTitle && disabled;
        bookInfo.hidden = bookDetails.hidden && !previousButton;

        popup.setAttribute("data-esj-selecting", String(rangeMode.checked && !disabled));
        rangeFields.hidden = !rangeMode.checked || disabled;
        if (rangeFields.hidden) {
            searchView.close();
        }
        selectAll.textContent = t("selection.selectAll");
        invertSelection.textContent = t("selection.invert");
        clearSelection.textContent = t("selection.clear");
        selectAll.disabled = invertSelection.disabled = clearSelection.disabled = disabled;
        directoryView?.setSelection(selected);

        // 章数与缓存复用预览使用同一份选择计划
        const selection = getSelection();
        const plan = selection
            ? createDownloadPlan({ tasks: selectDownloadTasks(preview.tasks, selection), selection })
            : null;
        chapterCount.hidden = disabled;
        chapterCount.textContent = allMode.checked
            ? t("range.chapterCount", { count: preview.tasks.length })
            : t("selection.selectedCount", { count: selected.size });
        totalCount.hidden = disabled || allMode.checked;
        totalCount.textContent = t("selection.directoryTotal", { count: preview.tasks.length });

        summary.hidden = disabled;
        imageLabel.textContent = t("range.imagesLabel");
        imageValue.textContent = t(options.imageEnabled ? "range.imagesEnabled" : "range.imagesDisabled");
        imageValue.style.color = options.imageEnabled ? "#217745" : "#666";
        cacheLabel.textContent = t("range.summary") + " ";
        cacheValue.textContent = String(plan?.readyCount(preview.cachedIndexes) || 0);
        cacheUnit.textContent = " " + t("range.cacheUnit");
        cacheReuse.hidden = preview.cacheWillBeInvalidated;

        // 准备状态、空选与整书缓存失效提示
        cacheWarning.hidden = Boolean(stage) || !preview.cacheWillBeInvalidated;
        cacheWarning.textContent = "⚠️ " + t("range.cacheDiscardWarning", { count: preview.cacheCount });
        validation.textContent = stage
            ? t(PREPARATION_MESSAGES[stage])
            : preview.preparationErrorKey
              ? t(preview.preparationErrorKey)
              : !selection
                ? t("selection.empty")
                : "";
        validation.hidden = !validation.textContent;

        cancelButton.textContent = t("common.cancel");
        if (previousButton) {
            previousButton.textContent = t("range.openPrevious");
            previousButton.title = formatSelectionSummary(options.existingSelection);
            previousButton.setAttribute("aria-label", t("range.openPrevious") + " " + previousButton.title);
        }
        downloadButton.disabled = !selection;
        downloadButton.textContent = preview.cacheWillBeInvalidated
            ? t("range.clearAndDownload")
            : allMode.checked
              ? t("range.download")
              : t("selection.downloadSelected", { count: selected.size });

        searchView.refresh();
    };

    const buildDirectory = () => {
        directoryView?.dispose();
        searchView.close();
        directoryView = createChapterDirectoryView({
            ...(preview.directory ? { snapshot: preview.directory } : {}),
            tasks: preview.tasks,
            selectedIndexes: selected,
            onSelect(indexes, checked) {
                if (settled || unavailable() || !rangeMode.checked) {
                    directoryView?.setSelection(selected);
                    return;
                }

                indexes.forEach((index) => {
                    if (checked) {
                        selected.add(index);
                    } else {
                        selected.delete(index);
                    }
                });

                refresh();
            }
        });
        directoryBox.replaceChildren(directoryView.element);
    };

    allMode.addEventListener("change", refresh);
    rangeMode.addEventListener("change", refresh);

    const footer = el("div", { className: "esj-selection-footer" }, [
        el("div", {}, [chapterCount, totalCount]),
        el("div", { className: "esj-selection-actions" }, [cancelButton, downloadButton])
    ]);

    // 搜索不放入滚动正文，避免下拉被裁切；只有目录本身负责章节滚动
    const popup = el("div", { id: "esj-range-selection", role: "dialog", "aria-modal": "true" }, [
        el("style", {}, [DOWNLOAD_SELECTION_STYLES]),
        header,
        el("div", { className: "esj-selection-body" }, [bookInfo, mode, validation, cacheWarning]),
        rangeFields,
        footer
    ]);

    // 挂载窗口后绑定页面锁、拖拽与语言订阅，再展示首次预览
    finishActiveSelection = finish;
    document.body.appendChild(popup);
    registerElementCleanup(popup, () => finish({ action: "cancel" }));
    acquirePageActionGroupLockForPopup(popup);
    enableDrag(popup, ".esj-common-header");
    unsubscribeLocale = subscribeInterfaceLocaleChange(refresh);

    if (!unavailable()) {
        buildDirectory();
    }
    refresh();
    (stage
        ? cancelButton
        : preview.preparationErrorKey && previousButton
          ? previousButton
          : rangeMode.checked
            ? rangeMode
            : allMode
    ).focus();

    return {
        decision,

        get closed() {
            return settled;
        },

        /**
         * 准备完成前不开放章节选择和下载
         */
        showPreparing(next) {
            if (!settled) {
                stage = next;
                refresh();
            }
        },

        /**
         * 接收准备结果，关闭后忽略更新；仅任务列表引用不变且未传 initialSelection 时保留勾选
         */
        showReady(next) {
            if (settled) {
                return;
            }

            const changed = preview.tasks !== next.tasks;
            preview = next;
            stage = undefined;

            if (next.initialSelection || changed) {
                restoreSelection(next.initialSelection);
                allMode.checked = !next.initialSelection || next.initialSelection.mode === "all";
                rangeMode.checked = !allMode.checked;
            }

            if (!directoryView || changed) {
                buildDirectory();
            }

            refresh();
        },

        /**
         * 取消本次选择并释放视图，重复调用保持幂等
         */
        close() {
            finish({ action: "cancel" });
        }
    };
}
