import { abortActiveDownload, state } from "../../core/state";
import type { BookDownloadLock } from "../../types";
import { fullCleanup, enableDrag, el } from "../../utils/dom";
import { log } from "../../utils/index";
import { createMinimizedTray } from "../tray";
import { createCommonHeader } from "./common";
import { bindInterfaceText, t } from "../locale";

/**
 * 锁定/解锁页面上的设置按钮
 * @param locked true=禁用, false=启用
 */
function toggleSettingsLock(locked: boolean) {
    const btns = document.querySelectorAll(".esj-settings-trigger");
    btns.forEach((b) => ((b as HTMLButtonElement).disabled = locked));
}

/**
 * 提示同一本书已有跨页面下载任务，单章导出不使用此弹窗
 */
export function showBookDownloadInProgressPopup(lock: BookDownloadLock): void {
    document.querySelector("#esj-book-lock")?.remove();

    const sourceText = t(lock.sourcePageType === "detail" ? "download.conflict.detail" : "download.conflict.forum");
    const closeAction = () => document.querySelector("#esj-book-lock")?.remove();
    const popup = el(
        "div",
        {
            id: "esj-book-lock",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:1000000;display:flex;flex-direction:column;"
        },
        [
            createCommonHeader(t("download.conflict.title"), closeAction),
            el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
                t("download.conflict.message", { source: sourceText })
            ]),
            el("div", { style: "padding:12px;display:flex;justify-content:flex-end;" }, [
                el(
                    "button",
                    {
                        style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;",
                        onclick: closeAction
                    },
                    [t("download.conflict.acknowledge")]
                )
            ])
        ]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
}

/**
 * 清理脚本已创建的弹窗和托盘后，创建并挂载下载进度弹窗
 */
export function createDownloadPopup(mode: "all" | "range" = "all"): HTMLElement {
    fullCleanup(state.originalTitle);

    toggleSettingsLock(true);

    function onCancel() {
        abortActiveDownload();
        const btn = document.querySelector("#esj-cancel") as HTMLButtonElement;
        if (btn) {
            btn.disabled = true;
            btn.textContent = t("download.popup.saving");
            btn.style.backgroundColor = "#999";
        }
        log(t("download.popup.stoppingLog"));
    }

    function onClose() {
        abortActiveDownload();
        fullCleanup(state.originalTitle);
    }

    function onMinimize() {
        const popup = document.querySelector("#esj-popup") as HTMLElement;
        if (popup) {
            popup.style.display = "none";
        }

        const headerTitle = popup?.querySelector(".esj-common-header span")?.textContent || "";
        const statusText = headerTitle.replace(/^📘\s*/, "").trim() || t("download.popup.running");

        createMinimizedTray(statusText);
    }

    const titleKey = mode === "range" ? "download.popup.rangeTitle" : "download.popup.title";
    const header = createCommonHeader(t(titleKey), onClose, onMinimize);
    const headerLabel = header.querySelector("span");
    if (headerLabel instanceof HTMLElement) {
        bindInterfaceText(headerLabel, titleKey);
    }

    // 找到里面的 span 加 ID，方便后续更新进度
    const span = header.querySelector("span");
    if (span) {
        span.id = "esj-title";
    }

    const progressBar = el("div", {
        id: "esj-progress",
        style: "width:0%;height:100%;background:#2b9bd7;transition:width .2s;"
    });

    const logBox = el("div", {
        id: "esj-log",
        style: "flex:1;margin:12px;background:#fafafa;border:1px solid #e6e6e6;padding:8px;border-radius:6px;overflow:auto;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;"
    });

    const btnCancel = el(
        "button",
        {
            id: "esj-cancel",
            style: "padding:8px 12px;background:#d9534f;color:#fff;border:none;border-radius:6px;cursor:pointer;",
            onclick: onCancel
        },
        [t("download.action.cancelTask")]
    );
    bindInterfaceText(btnCancel, "download.action.cancelTask");

    const popup = el(
        "div",
        {
            id: "esj-popup",
            style: "position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 520px; height:min(460px,calc(100vh - 32px)); background: #fff; border-radius: 8px; border: 1px solid #aaa; box-shadow: 0 0 18px rgba(0,0,0,0.28); z-index: 999999; display:flex;flex-direction:column;"
        },
        [
            header,
            el("div", { style: "padding:12px;" }, [
                bindInterfaceText(el("div", { style: "font-size:13px;margin-bottom:8px;" }), "download.popup.progress"),
                el("div", { style: "width:100%;height:14px;background:#eee;border-radius:8px;overflow:hidden;" }, [
                    progressBar
                ])
            ]),
            logBox,
            el("div", { style: "padding:0px 10px 10px;display:flex;gap:8px;justify-content:flex-end;" }, [btnCancel])
        ]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
    return popup;
}

/**
 * 创建确认下载的对话框
 * 根据是否有缓存显示不同的提示语
 */
export function createConfirmPopup(onOk: () => void, onCancel?: () => void, cacheHint?: string): void {
    fullCleanup(state.originalTitle);

    toggleSettingsLock(true);

    const cachedCount = state.globalChaptersMap.size;
    const hintText =
        cacheHint ||
        (cachedCount > 0 ? t("confirm.download.cached", { count: cachedCount }) : t("confirm.download.empty"));

    const closeAction = () => {
        document.querySelector("#esj-confirm")?.remove();
        toggleSettingsLock(false);
        if (onCancel) {
            onCancel();
        }
    };

    const header = createCommonHeader(t("confirm.download.title"), closeAction);

    const body = el("div", { style: "padding:16px;font-size:14px;" }, [hintText]);

    const btnCancel = el(
        "button",
        {
            id: "esj-confirm-cancel",
            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
            onclick: () => {
                popup.remove();
                if (onCancel) {
                    toggleSettingsLock(false);
                    onCancel();
                }
            }
        },
        [t("common.cancel")]
    );

    const btnOk = el(
        "button",
        {
            id: "esj-confirm-ok",
            style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;",
            onclick: () => {
                popup.remove();
                onOk();
            }
        },
        [t("common.confirm")]
    );

    const footer = el(
        "div",
        {
            style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;"
        },
        [btnCancel, btnOk]
    );

    const popup = el(
        "div",
        {
            id: "esj-confirm",
            style: "position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 380px; background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:999999;padding:0;display:flex;flex-direction:column;"
        },
        [header, body, footer]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
}
