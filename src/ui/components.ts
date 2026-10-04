import { el } from "../utils/dom";
import { createSettingsPanel } from "./popups";
import { bindInterfaceAttribute, bindInterfaceText, refreshBoundInterfaceText, t } from "./locale";
import { acquirePageActionGroupLock } from "./page-action-lock";

function hasBlockingDownloadPopup(): boolean {
    return Boolean(document.querySelector("#esj-format,#esj-range-selection"));
}

/**
 * 创建通用的设置按钮
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
                if ((e.target as HTMLButtonElement).disabled) {
                    return;
                }

                // 运行中的任务与最小化任务共用设置保护，避免中途改变任务界面
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
 */
export function createDownloadButton(
    id: string,
    text: string = t("button.download"),
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
                // 再次点击运行中的任务只恢复窗口，不启动第二次抓取
                const runningPopup = document.querySelector("#esj-popup") as HTMLElement;
                if (runningPopup) {
                    runningPopup.style.display = "flex";
                    document.querySelector("#esj-min-tray")?.remove();
                    return;
                }

                // 用户决策弹窗各自持有页面操作锁，入口层仍保留防重保护
                if (btn.disabled || hasBlockingDownloadPopup()) {
                    return;
                }

                // 任务结束后恢复入口文案
                const originalNodes = Array.from(btn.childNodes);

                const releasePageActions = acquirePageActionGroupLock();

                try {
                    // 文案准备也属于本次任务，异常时必须释放入口锁
                    btn.replaceChildren(
                        el("i", { className: "icon-refresh fa-spin" }),
                        " ",
                        bindInterfaceText(el("span"), "common.preparing")
                    );
                    await scrapeFn();
                } catch (error) {
                    console.error("Scrape Error", error);
                } finally {
                    // 导出弹窗如仍存在会持有自己的锁；本入口只释放当前点击任务
                    releasePageActions();
                    btn.replaceChildren(...originalNodes);
                    refreshBoundInterfaceText(btn);
                }
            }
        },
        [
            el("i", { className: "icon-download" }),
            " ",
            text === t("button.download") ? bindInterfaceText(el("span"), "button.download") : el("span", {}, [text])
        ]
    );

    return btn;
}
