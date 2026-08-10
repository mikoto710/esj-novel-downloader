import type {
    ProtectedChapterDecision,
    ProtectedChapterPrompt,
    ProtectedChapterPromptMessageCode
} from "../../core/download/contracts";
import { enableDrag, el } from "../../utils/dom";
import { createCommonHeader } from "./common";
import { subscribeInterfaceLocaleChange, t } from "../locale";

let disposeActiveProtectedPromptLocaleRefresh: (() => void) | null = null;

/**
 * 关闭已打开的密码章节弹窗并释放其语言切换订阅
 */
export function closeProtectedChapterPrompt(): void {
    disposeActiveProtectedPromptLocaleRefresh?.();
    document.querySelector("#esj-protected-chapter")?.remove();
}

/**
 * 将已打开的密码章节弹窗切换为不可交互的处理中状态，弹窗不存在时不执行操作
 */
export function setProtectedChapterPromptBusy(message = t("protected.busy")): void {
    const popup = document.querySelector("#esj-protected-chapter") as HTMLElement | null;
    if (!popup) {
        return;
    }
    popup.dataset.esjProtectedMessageState = "busy";
    const passwordInput = popup.querySelector("#esj-protected-password") as HTMLInputElement | null;
    const remember = popup.querySelector("#esj-protected-remember") as HTMLInputElement | null;
    const submit = popup.querySelector("#esj-protected-submit") as HTMLButtonElement | null;
    const skip = popup.querySelector("#esj-protected-skip") as HTMLButtonElement | null;
    const skipAll = popup.querySelector("#esj-protected-skip-all") as HTMLButtonElement | null;
    const error = popup.querySelector("#esj-protected-error") as HTMLElement | null;
    if (passwordInput) {
        passwordInput.disabled = true;
    }
    if (remember) {
        remember.disabled = true;
    }
    if (submit) {
        submit.disabled = true;
        submit.textContent = t("protected.busyShort");
    }
    if (skip) {
        skip.disabled = true;
    }
    if (skipAll) {
        skipAll.disabled = true;
    }
    if (error) {
        error.style.color = "#666";
        error.textContent = message;
    }
}

function formatProtectedPromptMessage(prompt: ProtectedChapterPrompt): string {
    if (prompt.message) {
        return prompt.message;
    }
    const code = prompt.messageCode;
    if (!code) {
        return t("protected.notice");
    }
    const keys: Record<Exclude<ProtectedChapterPromptMessageCode, "content-invalid">, Parameters<typeof t>[0]> = {
        "connection-failed": "protected.connectionFailed",
        "password-rejected": "protected.protocol.passwordRejected",
        "token-invalid": "protected.protocol.tokenInvalid",
        "response-invalid": "protected.protocol.responseInvalid",
        "unknown-status": "protected.protocol.unknownStatus"
    };
    if (code === "content-invalid") {
        return t(
            prompt.messageParams?.stillProtected
                ? "protected.protocol.contentStillProtected"
                : "protected.protocol.contentInvalid",
            prompt.messageParams
        );
    }
    return t(keys[code], prompt.messageParams);
}

/**
 * 提交密码时保留弹窗，授权结果可以在同一弹窗内继续显示；跳过或取消才结束当前交互
 */
export function promptProtectedChapterPassword(
    prompt: ProtectedChapterPrompt,
    signal?: AbortSignal,
    onPendingDecision?: (
        decision: Extract<ProtectedChapterDecision, { action: "skip-current" | "skip-all" | "cancel" }>
    ) => void
): Promise<ProtectedChapterDecision> {
    disposeActiveProtectedPromptLocaleRefresh?.();
    const existingPopup = document.querySelector("#esj-protected-chapter") as HTMLElement | null;
    if (signal?.aborted) {
        closeProtectedChapterPrompt();
        return Promise.resolve({ action: "cancel" });
    }

    return new Promise((resolve) => {
        let settled = false;
        let mountedPopup: HTMLElement;
        let disposeLocaleRefresh = () => {};
        const finish = (decision: ProtectedChapterDecision, keepOpen = false) => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            if (!keepOpen) {
                disposeLocaleRefresh();
                mountedPopup.remove();
            }
            resolve(decision);
        };
        const onAbort = () => finish({ action: "cancel" });
        const finishOrNotify = (
            decision: Extract<ProtectedChapterDecision, { action: "skip-current" | "skip-all" | "cancel" }>
        ) => {
            if (settled) {
                onPendingDecision?.(decision);
                return;
            }
            finish(decision);
        };
        const hasFailureMessage = Boolean(prompt.message || prompt.messageCode);
        const error = el("div", {
            id: "esj-protected-error",
            style: `min-height:20px;margin-top:8px;color:${hasFailureMessage ? "#c62828" : "#666"};font-size:13px;`
        });
        error.textContent = formatProtectedPromptMessage(prompt);
        const passwordInput = el("input", {
            id: "esj-protected-password",
            type: "text",
            autocomplete: "off",
            value: prompt.initialPassword || "",
            style: "width:100%;box-sizing:border-box;padding:9px;border:1px solid #bbb;border-radius:5px;"
        }) as HTMLInputElement;
        const remember = el("input", {
            id: "esj-protected-remember",
            type: "checkbox",
            checked: prompt.rememberPassword === true
        }) as HTMLInputElement;
        const submit = () => {
            const password = passwordInput.value;
            if (!password) {
                mountedPopup.dataset.esjProtectedMessageState = "required";
                error.textContent = t("protected.passwordRequired");
                error.style.color = "#c62828";
                passwordInput.focus();
                return;
            }
            setProtectedChapterPromptBusy();
            finish({ action: "submit", password, rememberPassword: remember.checked }, true);
        };
        passwordInput.onkeydown = (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        };
        const header = createCommonHeader(t("protected.required"), () => finishOrNotify({ action: "cancel" }));
        const body = el("div", { style: "padding:16px;font-size:14px;line-height:1.6;color:#333;" }, [
            el("div", { style: "font-weight:bold;" }, [prompt.task.title]),
            el("div", { id: "esj-protected-position", style: "margin:4px 0 10px;color:#666;" }, [
                t(prompt.selectionMode === "range" ? "protected.positionRange" : "protected.position", {
                    index: prompt.taskOrder ?? prompt.task.index + 1,
                    total: prompt.totalChapters,
                    sourceIndex: prompt.task.index + 1,
                    pending: prompt.pendingCount
                })
            ]),
            el(
                "a",
                {
                    href: prompt.task.url,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    id: "esj-protected-open-chapter",
                    style: "display:inline-block;margin-bottom:10px;"
                },
                [t("protected.openChapter")]
            ),
            passwordInput,
            el("label", { style: "display:flex;gap:7px;align-items:flex-start;margin-top:10px;cursor:pointer;" }, [
                remember,
                el("span", { id: "esj-protected-remember-label" }, [t("protected.remember")])
            ]),
            error
        ]);
        const footer = el(
            "div",
            {
                id: "esj-protected-actions",
                style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;"
            },
            [
                el(
                    "button",
                    {
                        id: "esj-protected-cancel",
                        type: "button",
                        className: "esj-protected-action esj-protected-action-default",
                        onclick: () => finishOrNotify({ action: "cancel" })
                    },
                    [t("download.action.cancelTask")]
                ),
                el(
                    "button",
                    {
                        id: "esj-protected-skip-all",
                        type: "button",
                        className: "esj-protected-action esj-protected-action-default",
                        onclick: () => finishOrNotify({ action: "skip-all" })
                    },
                    [t("protected.skipRemaining")]
                ),
                el(
                    "button",
                    {
                        id: "esj-protected-skip",
                        type: "button",
                        className: "esj-protected-action esj-protected-action-default",
                        onclick: () => finishOrNotify({ action: "skip-current" })
                    },
                    [t("download.action.skipChapter")]
                ),
                el(
                    "button",
                    {
                        id: "esj-protected-submit",
                        type: "button",
                        className: "esj-protected-action esj-protected-action-primary",
                        onclick: submit
                    },
                    [t(prompt.retryConnection ? "protected.retryConnection" : "protected.submit")]
                )
            ]
        );
        const popup = el(
            "div",
            {
                id: "esj-protected-chapter",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000002;"
            },
            [header, body, footer]
        );
        if (existingPopup) {
            existingPopup.replaceChildren(...Array.from(popup.childNodes));
            mountedPopup = existingPopup;
        } else {
            document.body.appendChild(popup);
            mountedPopup = popup;
        }
        mountedPopup.dataset.esjProtectedMessageState = "prompt";
        const refreshPromptText = () => {
            const headerLabel = mountedPopup.querySelector(".esj-common-header span");
            const position = mountedPopup.querySelector("#esj-protected-position");
            const openChapter = mountedPopup.querySelector("#esj-protected-open-chapter");
            const rememberLabel = mountedPopup.querySelector("#esj-protected-remember-label");
            const cancel = mountedPopup.querySelector("#esj-protected-cancel");
            const skipAll = mountedPopup.querySelector("#esj-protected-skip-all");
            const skip = mountedPopup.querySelector("#esj-protected-skip");
            const submitButton = mountedPopup.querySelector("#esj-protected-submit") as HTMLButtonElement | null;
            if (headerLabel) {
                headerLabel.textContent = t("protected.required");
            }
            if (position) {
                position.textContent = t(
                    prompt.selectionMode === "range" ? "protected.positionRange" : "protected.position",
                    {
                        index: prompt.taskOrder ?? prompt.task.index + 1,
                        total: prompt.totalChapters,
                        sourceIndex: prompt.task.index + 1,
                        pending: prompt.pendingCount
                    }
                );
            }
            if (openChapter) {
                openChapter.textContent = t("protected.openChapter");
            }
            if (rememberLabel) {
                rememberLabel.textContent = t("protected.remember");
            }
            if (cancel) {
                cancel.textContent = t("download.action.cancelTask");
            }
            if (skipAll) {
                skipAll.textContent = t("protected.skipRemaining");
            }
            if (skip) {
                skip.textContent = t("download.action.skipChapter");
            }
            const messageState = mountedPopup.dataset.esjProtectedMessageState;
            if (submitButton) {
                submitButton.textContent = t(
                    messageState === "busy"
                        ? "protected.busyShort"
                        : prompt.retryConnection
                          ? "protected.retryConnection"
                          : "protected.submit"
                );
            }
            if (messageState === "busy") {
                error.textContent = t("protected.busy");
            } else if (messageState === "required") {
                error.textContent = t("protected.passwordRequired");
            } else {
                error.textContent = formatProtectedPromptMessage(prompt);
            }
        };
        const unsubscribeLocale = subscribeInterfaceLocaleChange(() => {
            if (!mountedPopup.isConnected) {
                disposeLocaleRefresh();
                return;
            }
            refreshPromptText();
        });
        disposeLocaleRefresh = () => {
            unsubscribeLocale();
            if (disposeActiveProtectedPromptLocaleRefresh === disposeLocaleRefresh) {
                disposeActiveProtectedPromptLocaleRefresh = null;
            }
        };
        disposeActiveProtectedPromptLocaleRefresh = disposeLocaleRefresh;
        enableDrag(mountedPopup, ".esj-common-header");
        passwordInput.focus();
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
