import { el, enableDrag } from "../../utils/dom";
import { createCommonHeader } from "./common";
import { listBrowserDiagnosticSessions } from "../../adapters/browser-diagnostics";
import { createDiagnosticPopup } from "./diagnostics";
import { t } from "../locale";

export type MessagePopupTone = "info" | "warning" | "error";

export interface MessagePopupOptions {
    tone: MessagePopupTone;
    title?: string;
    message: string;
    details?: string | ReadonlyArray<string>;
    closeText?: string;
}

const tonePresentation: Record<
    MessagePopupTone,
    {
        icon: string;
        title: "common.infoTitle" | "common.warningTitle" | "common.errorTitle";
        color: string;
        border: string;
        background: string;
    }
> = {
    info: {
        icon: "ℹ️",
        title: "common.infoTitle",
        color: "#24566f",
        border: "#8dc9e8",
        background: "#eef7fc"
    },
    warning: {
        icon: "⚠️",
        title: "common.warningTitle",
        color: "#8a5a00",
        border: "#e6a23c",
        background: "#fff7e6"
    },
    error: {
        icon: "❌",
        title: "common.errorTitle",
        color: "#a12622",
        border: "#d9534f",
        background: "#fff0f0"
    }
};

/**
 * 显示单实例通用消息弹窗，重复调用时以最新消息替换旧弹窗
 */
export function showMessagePopup(options: MessagePopupOptions): HTMLElement {
    document.querySelector("#esj-message-popup")?.remove();

    const presentation = tonePresentation[options.tone];
    const details = options.details
        ? typeof options.details === "string"
            ? options.details
            : options.details.join("\n")
        : "";
    const close = () => popup.remove();
    const titleId = "esj-message-title";
    const header = createCommonHeader(`${presentation.icon} ${options.title || t(presentation.title)}`, close);
    header.querySelector("span")?.setAttribute("id", titleId);

    const bodyChildren: Array<string | Node> = [
        el(
            "div",
            {
                id: "esj-message-summary",
                style: `padding:10px 12px;border:1px solid ${presentation.border};background:${presentation.background};color:${presentation.color};border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;`
            },
            [options.message]
        )
    ];
    if (details) {
        bodyChildren.push(
            el(
                "pre",
                {
                    id: "esj-message-details",
                    style: "margin:12px 0 0;padding:10px 12px;max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f7f7;color:#444;border:1px solid #ddd;border-radius:6px;font:13px/1.6 monospace;"
                },
                [details]
            )
        );
    }

    const footerButtons: Array<string | Node> = [];
    const diagnosticStore = options.tone === "error" ? listBrowserDiagnosticSessions() : null;
    if (diagnosticStore && diagnosticStore.active.length + diagnosticStore.history.length > 0) {
        footerButtons.push(
            el(
                "button",
                {
                    id: "esj-message-diagnostic",
                    style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:1px solid #2b9bd7;border-radius:6px;cursor:pointer;",
                    onclick: () => {
                        close();
                        createDiagnosticPopup();
                    }
                },
                [t("common.viewDiagnostics")]
            )
        );
    }
    footerButtons.push(
        el(
            "button",
            {
                id: "esj-message-close",
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: close
            },
            [options.closeText || t("common.close")]
        )
    );

    const popup = el(
        "div",
        {
            id: "esj-message-popup",
            role: options.tone === "info" ? "dialog" : "alertdialog",
            "aria-modal": "true",
            "aria-labelledby": titleId,
            "data-tone": options.tone,
            style: `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:${details ? "440px" : "380px"};max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000002;display:flex;flex-direction:column;`
        },
        [
            header,
            el(
                "div",
                { style: "padding:16px;font-size:15px;line-height:1.7;min-height:0;overflow:auto;" },
                bodyChildren
            ),
            el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, footerButtons)
        ]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
    (popup.querySelector("#esj-message-close") as HTMLButtonElement | null)?.focus();
    return popup;
}
