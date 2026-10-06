import { el } from "../dom";
import { bindInterfaceAttribute } from "../locale";

/**
 * 创建弹窗公共标题栏
 */
export function createCommonHeader(title: string, onClose: () => void, onMinimize?: () => void): HTMLElement {
    const buttons: HTMLElement[] = [];

    if (onMinimize) {
        buttons.push(
            bindInterfaceAttribute(
                bindInterfaceAttribute(
                    el(
                        "button",
                        {
                            style: "border:none;background:#81d4fa;color:#000;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;margin-right:5px;",
                            onclick: onMinimize
                        },
                        ["＿"]
                    ),
                    "title",
                    "common.minimize"
                ),
                "aria-label",
                "common.minimize"
            )
        );
    }

    buttons.push(
        bindInterfaceAttribute(
            bindInterfaceAttribute(
                el(
                    "button",
                    {
                        style: "border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;",
                        onclick: onClose
                    },
                    ["✕"]
                ),
                "title",
                "common.close"
            ),
            "aria-label",
            "common.close"
        )
    );

    // 标题和操作区左右排列，整个标题栏作为弹窗拖拽手柄
    return el(
        "div",
        {
            className: "esj-common-header",
            style: "padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;"
        },
        [el("span", { style: "font-weight:bold;" }, [title]), el("div", { style: "display:flex;" }, buttons)]
    );
}
