import { el, enableDrag, registerElementCleanup, removeElement } from "../dom";
import { bindInterfaceAttribute } from "../locale";

/**
 * 创建弹窗公共标题栏
 */
export function createCommonHeader(title: string, onClose: () => void, onMinimize?: () => void): HTMLElement {
    const buttons: HTMLElement[] = [];

    if (onMinimize) {
        const minimizeButton = el(
            "button",
            {
                style: "border:none;background:#81d4fa;color:#000;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;margin-right:5px;",
                onclick: onMinimize
            },
            ["＿"]
        );
        bindInterfaceAttribute(minimizeButton, "title", "common.minimize");
        bindInterfaceAttribute(minimizeButton, "aria-label", "common.minimize");
        buttons.push(minimizeButton);
    }

    const closeButton = el(
        "button",
        {
            style: "border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: onClose
        },
        ["✕"]
    );
    bindInterfaceAttribute(closeButton, "title", "common.close");
    bindInterfaceAttribute(closeButton, "aria-label", "common.close");
    buttons.push(closeButton);

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

/**
 * 显示一次性决策弹窗；替换、任务中止或所属窗口关闭时返回约定的取消值
 */
export function showDecisionDialog<T>(
    options: {
        dismissed: T;
        owner?: Element | undefined;
        signal?: AbortSignal | undefined;
        focus?: string;
    },
    createPopup: (finish: (decision: T) => void) => HTMLElement
): Promise<T> {
    const { dismissed, owner, signal, focus } = options;
    if (signal?.aborted || (owner && !owner.isConnected)) {
        return Promise.resolve(dismissed);
    }

    return new Promise((resolve) => {
        let result = dismissed;
        const popup = createPopup((decision) => {
            if (popup.isConnected && (!owner || owner.isConnected)) {
                result = decision;
            }
            removeElement(popup);
        });
        removeElement(document.getElementById(popup.id));

        // 关闭只释放本次弹窗的等待和监听，旧窗口不能移除后来创建的同名弹窗
        const close = () => removeElement(popup);
        const releaseOwner = owner && registerElementCleanup(owner, close);
        registerElementCleanup(popup, () => {
            releaseOwner?.();
            signal?.removeEventListener("abort", close);
            resolve(result);
        });
        signal?.addEventListener("abort", close, { once: true });

        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        if (focus) {
            popup.querySelector<HTMLElement>(focus)?.focus();
        }
    });
}

/**
 * 组装含取消和继续按钮的确认框，关闭与结算由 showDecisionDialog 管理
 */
export function createConfirmationPopup(
    finish: (choice: boolean) => void,
    options: {
        id: string;
        title: string;
        body: (string | Node)[];
        cancel: { text: string; id?: string };
        confirm: { text: string; id: string };
    }
): HTMLElement {
    const cancel = el(
        "button",
        {
            ...(options.cancel.id ? { id: options.cancel.id } : {}),
            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
            onclick: () => finish(false)
        },
        [options.cancel.text]
    );
    const confirm = el(
        "button",
        {
            id: options.confirm.id,
            style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: () => finish(true)
        },
        [options.confirm.text]
    );

    return el(
        "div",
        {
            id: options.id,
            role: "dialog",
            "aria-modal": "true",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:440px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
        },
        [
            createCommonHeader(options.title, () => finish(false)),
            el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, options.body),
            el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [cancel, confirm])
        ]
    );
}
