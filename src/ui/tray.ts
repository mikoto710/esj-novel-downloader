import { el } from "../utils/dom";
import { bindInterfaceAttribute, t } from "./locale";

/**
 * 创建最小化托盘悬浮球
 */
export function createMinimizedTray(progressText: string): HTMLElement {
    const old = document.querySelector("#esj-min-tray");
    if (old) {
        old.remove();
    }

    const tray = el(
        "div",
        {
            id: "esj-min-tray",
            title: t("tray.restore"),
            onclick: () => {
                const popup = document.querySelector("#esj-popup") as HTMLElement | null;
                if (popup) {
                    popup.style.display = "flex";
                    tray.remove();
                }
            }
        },
        [el("span", {}, ["📘"]), el("span", { id: "esj-tray-text" }, [progressText || t("download.popup.running")])]
    );

    document.body.appendChild(tray);
    bindInterfaceAttribute(tray, "title", "tray.restore");
    return tray;
}

/**
 * 更新托盘上的进度文字
 */
export function updateTrayText(text: string): void {
    const element = document.querySelector("#esj-tray-text");
    if (element) {
        element.textContent = text;
    }
}
