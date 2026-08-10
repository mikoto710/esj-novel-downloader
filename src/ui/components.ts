import { el } from "../utils/dom";
import { state } from "../core/state";
import { showFormatChoice, createSettingsPanel } from "./popups";
import { bindInterfaceAttribute, bindInterfaceText, t } from "./locale";
import { confirmReplaceRangeExport } from "./range-selection-popup";
import { acquirePageActionGroupLock } from "./page-action-lock";

function hasBlockingDownloadPopup(): boolean {
    return Boolean(document.querySelector("#esj-confirm,#esj-format,#esj-range-selection,#esj-range-replace-confirm"));
}

/**
 * 创建通用的设置按钮
 * @param customClass 额外的 CSS 类 (如 "m-b-10")
 */
export function createSettingButton(customClass: string = ""): HTMLElement {
    const button = el(
        "button",
        {
            className: `btn btn-primary esj-settings-trigger ${customClass}`,
            title: t("button.settings"),
            "aria-label": t("button.settings"),
            style: "color: white; cursor: pointer; margin-left: 10px",
            onclick: (e: Event) => {
                e.preventDefault();
                // 如果被禁用，直接返回
                if ((e.target as HTMLButtonElement).disabled) {
                    return;
                }
                // 互斥锁：有任务运行时禁止
                if (document.querySelector("#esj-popup") || document.querySelector("#esj-min-tray")) {
                    return;
                }
                createSettingsPanel();
            }
        },
        [el("i", { className: "icon-settings" })]
    );
    bindInterfaceAttribute(button, "title", "button.settings");
    bindInterfaceAttribute(button, "aria-label", "button.settings");
    return button;
}

/**
 * 创建通用的下载按钮
 * @param id 元素的 DOM ID
 * @param text 按钮显示的文字
 * @param scrapeFn 点击后执行的抓取函数 (async)
 * @param customClass 额外的 CSS 类 (如 "m-b-10")
 */
export function createDownloadButton(
    id: string,
    text: string = t("button.downloadAll"),
    scrapeFn: () => Promise<void>,
    customClass: string = ""
): HTMLElement {
    const btn = el(
        "button",
        {
            id: id,
            className: `btn btn-info esj-download-trigger ${customClass}`,
            style: "color: white; cursor: pointer; margin-left: 5px;",
            onclick: async () => {
                // 防止弹窗已存在的情景
                const runningPopup = document.querySelector("#esj-popup") as HTMLElement;
                if (runningPopup) {
                    // 恢复弹窗显示
                    runningPopup.style.display = "flex";
                    document.querySelector("#esj-min-tray")?.remove();
                    return;
                }

                // 用户决策弹窗各自持有页面操作锁，入口层仍保留防重保护
                if (btn.disabled || hasBlockingDownloadPopup()) {
                    return;
                }

                // 保存原始 HTML，以便范围结果替换确认取消或任务结束时恢复
                const originalHtml = btn.innerHTML;
                const preparingHtml = `<i class="icon-refresh fa-spin"></i> ${t("common.preparing")}`;

                // 如果有缓存，直接显示导出窗口，不进入 loading
                if (state.cachedData) {
                    if (state.cachedData.exportContext?.selection?.mode !== "range") {
                        showFormatChoice();
                        return;
                    }
                    btn.innerHTML = preparingHtml;
                    if (!(await confirmReplaceRangeExport())) {
                        btn.innerHTML = originalHtml;
                        return;
                    }
                }

                if (btn.disabled || hasBlockingDownloadPopup()) {
                    btn.innerHTML = originalHtml;
                    return;
                }

                const releasePageActions = acquirePageActionGroupLock();

                // 执行抓取任务，进入 loading
                btn.innerHTML = preparingHtml;

                try {
                    await scrapeFn();
                } catch (err: any) {
                    console.error("Scrape Error: " + err.message);
                } finally {
                    // 导出弹窗如仍存在会持有自己的锁；本入口只释放当前点击任务
                    btn.innerHTML = originalHtml;
                    releasePageActions();
                }
            }
        },
        [
            el("i", { className: "icon-download" }),
            " ",
            text === t("button.downloadAll")
                ? bindInterfaceText(el("span"), "button.downloadAll")
                : el("span", {}, [text])
        ]
    );

    return btn;
}

/**
 * 创建独立范围下载按钮；已有导出结果由范围选择弹窗决定复用或替换
 */
export function createRangeDownloadButton(
    id: string,
    scrapeFn: () => Promise<void>,
    customClass: string = ""
): HTMLElement {
    const btn = el(
        "button",
        {
            id,
            className: `btn btn-info esj-download-trigger ${customClass}`,
            style: "color: white; cursor: pointer; margin-left: 5px;",
            onclick: async () => {
                const runningPopup = document.querySelector("#esj-popup") as HTMLElement | null;
                if (runningPopup) {
                    runningPopup.style.display = "flex";
                    document.querySelector("#esj-min-tray")?.remove();
                    return;
                }
                if (btn.disabled || hasBlockingDownloadPopup()) {
                    return;
                }
                const originalHtml = btn.innerHTML;
                const releasePageActions = acquirePageActionGroupLock();
                btn.innerHTML = `<i class="icon-refresh fa-spin"></i> ${t("common.preparing")}`;
                try {
                    await scrapeFn();
                } catch (error) {
                    console.error("Range Scrape Error", error);
                } finally {
                    btn.innerHTML = originalHtml;
                    releasePageActions();
                }
            }
        },
        [el("i", { className: "icon-download" }), " ", bindInterfaceText(el("span"), "button.downloadRange")]
    );
    return btn;
}
