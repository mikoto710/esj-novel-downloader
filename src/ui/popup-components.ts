import { el } from "../utils/dom";
import { t } from "./locale";

/**
 * 创建弹窗公共标题栏
 * @param title 标题
 * @param onClose 关闭回调
 * @param onMinimize 可选的最小化回调
 */
export function createCommonHeader(title: string, onClose: () => void, onMinimize?: () => void): HTMLElement {
    const buttons: HTMLElement[] = [];

    if (onMinimize) {
        buttons.push(
            el(
                "button",
                {
                    title: t("common.minimize"),
                    "aria-label": t("common.minimize"),
                    style: "border:none;background:#81d4fa;color:#000;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;margin-right:5px;",
                    onclick: onMinimize
                },
                ["＿"]
            )
        );
    }

    buttons.push(
        el(
            "button",
            {
                title: t("common.close"),
                "aria-label": t("common.close"),
                style: "border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;",
                onclick: onClose
            },
            ["✕"]
        )
    );

    return el(
        "div",
        {
            className: "esj-common-header",
            style: "padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;"
        },
        [el("span", { style: "font-weight:bold;" }, [title]), el("div", { style: "display:flex;" }, buttons)]
    );
}
