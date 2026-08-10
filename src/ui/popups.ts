import { abortActiveDownload, state } from "../core/state";
import { fullCleanup, enableDrag, el } from "../utils/dom";
import { log, triggerDownload } from "../utils/index";
import { createMinimizedTray } from "./tray";
import { buildEpub } from "../core/epub";
import { BookDownloadLock, CachedData } from "../types";
import {
    getConcurrency,
    setConcurrency,
    setImageDownloadSetting,
    getImageDownloadSetting,
    getEpubTagPageSetting,
    setEpubTagPageSetting,
    getInterfaceLocalePreference,
    setInterfaceLocalePreference
} from "../core/config";
import { isInterfaceLocalePreference } from "../core/locale";
import { buildHtml } from "../core/html";
import { createCacheManagerPopup } from "./cache-manager";
import { createDownloadHistoryPopup } from "./download-history";
import { addDownloadHistory } from "../core/download-history";
import type {
    IncompleteChapterDecision,
    IncompleteChapterDetection,
    MappingFontFailure,
    MappingFontDetection,
    MappingFontSummary,
    ProtectedChapterDecision,
    ProtectedChapterPrompt,
    ProtectedChapterPromptMessageCode
} from "../core/download/contracts";
import { MappingFontError } from "../core/mapping-font";
import { showMessagePopup } from "./message-popup";
import { createCommonHeader } from "./popup-components";
import { recordBrowserDiagnosticExport, recordBrowserDiagnosticFailure } from "../adapters/browser-diagnostics";
import { createDiagnosticPopup } from "./diagnostics";
import { listActiveBookDownloadLocks } from "../core/book-lock";
import {
    bindInterfaceAttribute,
    bindInterfaceText,
    publishInterfaceLocaleChange,
    subscribeInterfaceLocaleChange,
    t
} from "./locale";
import { formatMappingFontError } from "./mapping-font-messages";
import { createBookExportFilename } from "../core/download/export-filename";

/**
 * 锁定/解锁页面上的设置按钮
 * @param locked true=禁用, false=启用
 */
function toggleSettingsLock(locked: boolean) {
    const btns = document.querySelectorAll(".esj-settings-trigger");
    btns.forEach((b) => ((b as HTMLButtonElement).disabled = locked));
}

/**
 * 锁定/解锁页面上的下载按钮
 * @param locked true=禁用, false=启用
 */
function toggleDownloadLock(locked: boolean) {
    const btns = document.querySelectorAll(".esj-download-trigger");
    btns.forEach((b) => ((b as HTMLButtonElement).disabled = locked));
}

function formatMappingFontBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const MAX_EXPORT_ERROR_DETAIL_LENGTH = 2_000;
const diagnosticExportFormat = { TXT: "txt", EPUB: "epub", HTML: "html" } as const;
type ExportFailureStage = "generate" | "download";
let disposeActiveProtectedPromptLocaleRefresh: (() => void) | null = null;
let disposeActiveFormatLocaleRefresh: (() => void) | null = null;

function confirmImageSettingChange(activeTaskCount: number): Promise<boolean> {
    document.querySelector("#esj-image-setting-task-confirm")?.remove();

    return new Promise((resolve) => {
        let settled = false;
        const finish = (confirmed: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            popup.remove();
            resolve(confirmed);
        };
        const popup = el(
            "div",
            {
                id: "esj-image-setting-task-confirm",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:440px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
            },
            [
                createCommonHeader(t("confirm.imageSettings.title"), () => finish(false)),
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
                    t("confirm.imageSettings.message", { count: activeTaskCount })
                ]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
                    el(
                        "button",
                        {
                            id: "esj-image-setting-task-confirm-cancel",
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: () => finish(false)
                        },
                        [t("common.cancel")]
                    ),
                    el(
                        "button",
                        {
                            id: "esj-image-setting-task-confirm-continue",
                            style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
                            onclick: () => finish(true)
                        },
                        [t("confirm.imageSettings.continue")]
                    )
                ])
            ]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-image-setting-task-confirm-cancel") as HTMLButtonElement | null)?.focus();
    });
}

function getExportErrorDetails(error: unknown): string {
    const details =
        error instanceof MappingFontError
            ? formatMappingFontError(error.code)
            : error instanceof Error
              ? error.message
              : String(error);
    if (details.length <= MAX_EXPORT_ERROR_DETAIL_LENGTH) {
        return details;
    }
    return `${details.slice(0, MAX_EXPORT_ERROR_DETAIL_LENGTH)}\n${t("export.failure.truncated")}`;
}

function showExportFailure(format: "TXT" | "EPUB" | "HTML", stage: ExportFailureStage, error: unknown): void {
    const details = getExportErrorDetails(error);
    const stageText = t(stage === "generate" ? "export.stage.generate" : "export.stage.download");
    recordBrowserDiagnosticExport({
        scope: "full",
        format: diagnosticExportFormat[format],
        outcome: "failed",
        generated: stage === "download",
        downloadTriggered: false,
        failureStage: stage
    });
    recordBrowserDiagnosticFailure({
        scope: "export",
        stage: `${format.toLowerCase()}-${stage}`,
        code: error instanceof Error ? error.name || "export-failed" : "export-failed",
        message: details
    });
    showMessagePopup({
        tone: "error",
        title: t("export.failure.title", { format, stage: stageText }),
        message: t("export.failure.message", { format, stage: stageText }),
        details
    });
}

/**
 * 在下载进度弹窗中持续显示映射字体限制
 */
export function updateMappingFontWarning(summary: MappingFontSummary): void {
    const popup = document.querySelector("#esj-popup");
    if (!popup) {
        return;
    }
    let warning = popup.querySelector("#esj-mapping-warning") as HTMLElement | null;
    if (!warning) {
        warning = el("div", {
            id: "esj-mapping-warning",
            style: "margin:0 12px 8px;padding:10px 12px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:6px;font-size:13px;line-height:1.6;"
        });
        popup.querySelector("#esj-log")?.before(warning);
    }
    warning.textContent = t("mapping.warning", {
        count: summary.chapterCount,
        bytes: formatMappingFontBytes(summary.fontBytes)
    });
}

/**
 * 首次检测到映射正文后要求用户明确同意，关闭弹窗等同停止下载
 */
export function confirmMappingFontDownload(detection: MappingFontDetection, signal?: AbortSignal): Promise<boolean> {
    document.querySelector("#esj-mapping-confirm")?.remove();
    if (signal?.aborted) {
        return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (confirmed: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            popup.remove();
            resolve(confirmed);
        };
        const onAbort = () => finish(false);
        const header = createCommonHeader(t("mapping.detected.title"), () => finish(false));
        const body = el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
            el("div", { style: "font-weight:bold;margin-bottom:8px;" }, [detection.task.title]),
            t("mapping.detected.message"),
            el("div", { style: "margin-top:8px;color:#8a5a00;font-size:13px;" }, [
                t("mapping.detected.summary", {
                    count: detection.chapterCount,
                    bytes: formatMappingFontBytes(detection.fontBytes)
                })
            ]),
            el(
                "div",
                {
                    id: "esj-mapping-inflight-warning",
                    style: "margin-top:10px;padding:8px 10px;border:1px solid #f0c36d;background:#fff8e5;color:#7a5200;border-radius:5px;font-size:13px;"
                },
                [
                    detection.inFlightLimit > 0
                        ? t("mapping.detected.inflight", { count: detection.inFlightLimit })
                        : t("mapping.detected.paused")
                ]
            )
        ]);
        const footer = el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
            el(
                "button",
                {
                    id: "esj-mapping-stop",
                    style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                    onclick: () => finish(false)
                },
                [t("mapping.stop")]
            ),
            el(
                "button",
                {
                    id: "esj-mapping-continue",
                    style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
                    onclick: () => finish(true)
                },
                [t("mapping.continue")]
            )
        ]);
        const popup = el(
            "div",
            {
                id: "esj-mapping-confirm",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:440px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
            },
            [header, body, footer]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-mapping-continue") as HTMLButtonElement | null)?.focus();
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

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

/**
 * 自动补抓和持久化后仍存在缺章时，要求用户选择再次补抓、使用占位导出或取消
 */
export function confirmIncompleteChapters(
    detection: IncompleteChapterDetection,
    signal?: AbortSignal
): Promise<IncompleteChapterDecision> {
    document.querySelector("#esj-incomplete-chapters")?.remove();
    if (signal?.aborted) {
        return Promise.resolve("cancel");
    }

    return new Promise<IncompleteChapterDecision>((resolve) => {
        let settled = false;
        const abortListener = () => finish("cancel");

        const preview = detection.missingTasks.slice(0, 10).map((task) =>
            el("li", { style: "margin-bottom:8px;" }, [
                el("div", { style: "font-weight:bold;color:#333;" }, [
                    detection.selectionMode === "range"
                        ? t("download.missing.rangePosition", {
                              index: (detection.taskOrderByIndex?.get(task.index) ?? 0) + 1,
                              total: detection.totalChapters,
                              sourceIndex: task.index + 1
                          }) + ` ${task.title}`
                        : `[${task.index + 1}/${detection.totalChapters}] ${task.title}`
                ]),
                el("div", { style: "color:#666;font-size:12px;overflow-wrap:anywhere;" }, [task.url])
            ])
        );
        if (detection.missingTasks.length > preview.length) {
            preview.push(
                el("li", { style: "color:#8a5a00;" }, [
                    t("download.missing.remaining", { count: detection.missingTasks.length - preview.length })
                ])
            );
        }

        const popup = el(
            "div",
            {
                id: "esj-incomplete-chapters",
                role: "alertdialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
            },
            [
                createCommonHeader(t("download.missing.title"), () => finish("cancel")),
                el("div", { style: "padding:16px;font-size:15px;line-height:1.7;min-height:0;overflow:auto;" }, [
                    el(
                        "div",
                        {
                            style: "padding:10px 12px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:6px;"
                        },
                        [t("download.missing.message", { count: detection.missingTasks.length })]
                    ),
                    el("ol", { style: "margin:12px 0 0;padding-left:28px;" }, preview)
                ]),
                el(
                    "div",
                    {
                        style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;"
                    },
                    [
                        el(
                            "button",
                            {
                                id: "esj-incomplete-cancel",
                                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                                onclick: () => finish("cancel")
                            },
                            [t("download.action.cancelKeepCache")]
                        ),
                        el(
                            "button",
                            {
                                id: "esj-incomplete-export",
                                style: "padding:8px 12px;background:#fff7e6;color:#8a5a00;border:1px solid #e6a23c;border-radius:6px;cursor:pointer;",
                                onclick: () => finish("export-with-placeholders")
                            },
                            [t("download.action.exportPlaceholder")]
                        ),
                        el(
                            "button",
                            {
                                id: "esj-incomplete-retry",
                                style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:1px solid #2b9bd7;border-radius:6px;cursor:pointer;font-weight:bold;",
                                onclick: () => finish("retry")
                            },
                            [t("download.action.retryMissing")]
                        )
                    ]
                )
            ]
        );
        const finish = (decision: IncompleteChapterDecision) => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener("abort", abortListener);
            popup.remove();
            resolve(decision);
        };
        signal?.addEventListener("abort", abortListener, { once: true });
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-incomplete-retry") as HTMLButtonElement | null)?.focus();
    });
}

/**
 * 映射字体补抓后仍失败时给出明确摘要，禁止静默进入导出
 */
export function showMappingFontFailure(failures: readonly MappingFontFailure[]): void {
    const preview = failures
        .slice(0, 5)
        .map((failure) => `• ${failure.task.title}: ${formatMappingFontError(failure.code)}`)
        .join("\n");
    const remaining = failures.length > 5 ? t("mapping.failure.remaining", { count: failures.length - 5 }) : "";
    showMessagePopup({
        tone: "error",
        title: t("mapping.failure.title"),
        message: t("mapping.failure.message", { count: failures.length }),
        details: [preview, remaining].filter(Boolean)
    });
}

/**
 * 在 EPUB 或 HTML 导出前提示映射字型嵌入信息，关闭弹窗或选择返回时解析为 false
 */
export function confirmMappingFontExport(format: "EPUB" | "HTML", summary: MappingFontSummary): Promise<boolean> {
    document.querySelector("#esj-mapping-export-confirm")?.remove();
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (confirmed: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            popup.remove();
            resolve(confirmed);
        };
        const popup = el(
            "div",
            {
                id: "esj-mapping-export-confirm",
                role: "dialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:440px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
            },
            [
                createCommonHeader(t("mapping.export.title", { format }), () => finish(false)),
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
                    t("mapping.export.message", {
                        count: summary.chapterCount,
                        bytes: formatMappingFontBytes(summary.fontBytes),
                        format
                    })
                ]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
                    el(
                        "button",
                        {
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: () => finish(false)
                        },
                        [t("mapping.export.back")]
                    ),
                    el(
                        "button",
                        {
                            id: "esj-mapping-export-continue",
                            style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
                            onclick: () => finish(true)
                        },
                        [t("mapping.export.continue", { format })]
                    )
                ])
            ]
        );
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-mapping-export-continue") as HTMLButtonElement | null)?.focus();
    });
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

/**
 * 显示 TXT、EPUB 和 HTML 格式选择弹窗
 */
export function showFormatChoice(): void {
    if (!state.cachedData) {
        showMessagePopup({ tone: "info", title: t("export.none.title"), message: t("export.none.message") });
        return;
    }

    disposeActiveFormatLocaleRefresh?.();
    fullCleanup();

    // 禁用设置和下载按钮，防止重复操作
    toggleSettingsLock(true);
    toggleDownloadLock(true);

    const data = state.cachedData as CachedData;
    const mappedChapters = data.chapters.filter((chapter) => Boolean(chapter.mappingFont));
    const mappingSummary: MappingFontSummary = {
        chapterCount: mappedChapters.length,
        fontBytes: mappedChapters.reduce((total, chapter) => total + (chapter.mappingFont?.blob.size || 0), 0)
    };
    const hasMappedChapters = mappingSummary.chapterCount > 0;

    const closeAction = () => {
        disposeActiveFormatLocaleRefresh?.();
        document.querySelector("#esj-format")?.remove();
        toggleSettingsLock(false);
        toggleDownloadLock(false);
    };

    const header = createCommonHeader(t("export.title"), closeAction);

    const coverStatus = data.metadata.coverBlob
        ? el("div", { id: "esj-format-cover-status", style: "color:green;font-size:12px;margin-top:4px;" }, [
              t("export.coverReady")
          ])
        : el("div", { id: "esj-format-cover-status", style: "color:red;font-size:12px;margin-top:4px;" }, [
              t("export.coverMissing")
          ]);

    // 正文插图统计
    let imageStatus: HTMLElement | string = "";
    const isImageDownloadEnabled = data.exportContext?.imageEnabled ?? getImageDownloadSetting();

    if (isImageDownloadEnabled) {
        let successCount = 0;
        let failCount = 0;

        // 遍历统计
        data.chapters.forEach((chap) => {
            if (chap.images) {
                successCount += chap.images.length;
            }
            if (chap.imageErrors) {
                failCount += chap.imageErrors;
            }
        });

        const totalCount = successCount + failCount;

        if (totalCount > 0) {
            // 有图片处理记录，失败显示橙色，全成功显示蓝色
            const color = failCount > 0 ? "#e6a23c" : "#2b9bd7";
            const errorHint = failCount > 0 ? t("export.imagesFailed", { count: failCount }) : "";

            imageStatus = el(
                "div",
                { id: "esj-format-image-status", style: `color:${color}; font-size:12px; margin-top:4px;` },
                [`${t("export.images", { success: successCount, total: totalCount })}${errorHint}`]
            );
        } else {
            // 开启了开关但没抓到任何图
            imageStatus = el(
                "div",
                { id: "esj-format-image-status", style: "color:#999; font-size:12px; margin-top:4px;" },
                [t("export.imagesNone")]
            );
        }
    }

    const infoBody = el("div", { style: "padding:20px;font-size:14px;line-height:1.5;" }, [
        el("div", { id: "esj-format-book-status" }, [t("export.bookReady", { title: data.metadata.title })]),
        data.exportContext?.selection?.mode === "range"
            ? el("div", { id: "esj-format-range", style: "color:#2b6f9f;font-size:12px;margin-top:4px;" }, [
                  t("export.range", {
                      start: data.exportContext.selection.startChapter,
                      end: data.exportContext.selection.endChapter,
                      count: data.chapters.length
                  })
              ])
            : "",
        el("div", { id: "esj-format-chapter-count", style: "color:#666;font-size:12px;margin-top:4px;" }, [
            t("export.chapterCount", { count: data.chapters.length })
        ]),
        coverStatus,
        imageStatus,
        hasMappedChapters
            ? el(
                  "div",
                  {
                      id: "esj-format-mapping-warning",
                      style: "margin-top:10px;padding:10px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:6px;font-size:12px;line-height:1.6;"
                  },
                  [
                      t("export.mappingWarning", {
                          count: mappingSummary.chapterCount,
                          bytes: formatMappingFontBytes(mappingSummary.fontBytes)
                      })
                  ]
              )
            : ""
    ]);

    let epubExporting = false;
    let htmlExporting = false;

    const btnTxt = el(
        "button",
        {
            id: "esj-txt",
            disabled: hasMappedChapters,
            "aria-disabled": hasMappedChapters ? "true" : "false",
            title: hasMappedChapters ? t("export.txtBlocked") : t("export.downloadTxt"),
            style: `flex:1;padding:10px 0;border:1px solid #ccc;background:#f0f0f0;border-radius:6px;cursor:${hasMappedChapters ? "not-allowed" : "pointer"};font-weight:bold;color:${hasMappedChapters ? "#999" : "#333"};`,
            onclick: hasMappedChapters
                ? undefined
                : () => {
                      const filename = createBookExportFilename(
                          data.metadata.title,
                          "txt",
                          data.exportContext?.selection
                      );
                      let blob: Blob;
                      try {
                          blob = new Blob([data.txt], { type: "text/plain;charset=utf-8" });
                      } catch (error) {
                          showExportFailure("TXT", "generate", error);
                          return;
                      }
                      try {
                          triggerDownload(blob, filename);
                          recordSuccessfulExport("txt");
                          void recordBookExport("txt");
                      } catch (error) {
                          console.error(error);
                          showExportFailure("TXT", "download", error);
                      }
                  }
        },
        [hasMappedChapters ? t("export.txtDisabled") : t("export.downloadTxt")]
    );

    const btnEpub = el(
        "button",
        {
            id: "esj-epub",
            style: "flex:1;padding:10px 0;border:none;background:#2b9bd7;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: async () => handleEpubDownload()
        },
        [t("export.downloadEpub")]
    );

    const btnHtml = el(
        "button",
        {
            id: "esj-html",
            style: "flex:1;padding:10px 0;border:none;background:#999;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: async () => handleHtmlDownload()
        },
        [t("export.downloadHtml")]
    );

    const footer = el(
        "div",
        {
            style: "display:flex;gap:15px;justify-content:center;padding:0 20px 15px 20px;"
        },
        [btnTxt, btnEpub, btnHtml]
    );
    const txtDisabledReason = hasMappedChapters
        ? el(
              "div",
              {
                  id: "esj-format-txt-disabled-reason",
                  style: "padding:0 20px 16px;color:#a45b00;font-size:12px;line-height:1.5;"
              },
              [t("download.export.txtDisabled")]
          )
        : "";

    const popup = el(
        "div",
        {
            id: "esj-format",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;padding:0;display:flex;flex-direction:column;"
        },
        [header, infoBody, footer, txtDisabledReason]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");

    const refreshFormatChoiceText = () => {
        const headerLabel = header.querySelector("span");
        if (headerLabel) {
            headerLabel.textContent = t("export.title");
        }
        coverStatus.textContent = t(data.metadata.coverBlob ? "export.coverReady" : "export.coverMissing");
        const bookStatus = popup.querySelector("#esj-format-book-status");
        const chapterCount = popup.querySelector("#esj-format-chapter-count");
        const rangeStatus = popup.querySelector("#esj-format-range");
        if (bookStatus) {
            bookStatus.textContent = t("export.bookReady", { title: data.metadata.title });
        }
        if (chapterCount) {
            chapterCount.textContent = t("export.chapterCount", { count: data.chapters.length });
        }
        if (rangeStatus && data.exportContext?.selection?.mode === "range") {
            rangeStatus.textContent = t("export.range", {
                start: data.exportContext.selection.startChapter,
                end: data.exportContext.selection.endChapter,
                count: data.chapters.length
            });
        }
        if (imageStatus instanceof HTMLElement) {
            const successCount = data.chapters.reduce((count, chapter) => count + (chapter.images?.length || 0), 0);
            const failCount = data.chapters.reduce((count, chapter) => count + (chapter.imageErrors || 0), 0);
            const totalCount = successCount + failCount;
            imageStatus.textContent =
                totalCount > 0
                    ? `${t("export.images", { success: successCount, total: totalCount })}${
                          failCount > 0 ? t("export.imagesFailed", { count: failCount }) : ""
                      }`
                    : t("export.imagesNone");
        }
        const mappingWarning = popup.querySelector("#esj-format-mapping-warning");
        if (mappingWarning) {
            mappingWarning.textContent = t("export.mappingWarning", {
                count: mappingSummary.chapterCount,
                bytes: formatMappingFontBytes(mappingSummary.fontBytes)
            });
        }
        btnTxt.textContent = t(hasMappedChapters ? "export.txtDisabled" : "export.downloadTxt");
        btnTxt.title = t(hasMappedChapters ? "export.txtBlocked" : "export.downloadTxt");
        btnEpub.textContent = t(epubExporting ? "export.generating" : "export.downloadEpub");
        btnHtml.textContent = t(htmlExporting ? "export.generating" : "export.downloadHtml");
        if (txtDisabledReason instanceof HTMLElement) {
            txtDisabledReason.textContent = t("download.export.txtDisabled");
        }
    };
    const unsubscribeLocale = subscribeInterfaceLocaleChange(() => {
        if (!popup.isConnected) {
            disposeActiveFormatLocaleRefresh?.();
            return;
        }
        refreshFormatChoiceText();
    });
    const disposeLocaleRefresh = () => {
        unsubscribeLocale();
        if (disposeActiveFormatLocaleRefresh === disposeLocaleRefresh) {
            disposeActiveFormatLocaleRefresh = null;
        }
    };
    disposeActiveFormatLocaleRefresh = disposeLocaleRefresh;

    // 下载 EPUB
    async function handleEpubDownload() {
        if (epubExporting) {
            return;
        }
        epubExporting = true;
        const btn = document.querySelector("#esj-epub") as HTMLButtonElement;
        // 格式弹窗只消费创建时捕获的不可变导出快照，不跟随后续同书任务替换全局状态
        const currentData = data;
        const originalBg = btn.style.background;
        const oldTitle = document.title;
        try {
            btn.disabled = true;
            if (hasMappedChapters && !(await confirmMappingFontExport("EPUB", mappingSummary))) {
                recordCancelledExport("epub");
                return;
            }

            // 如果已经生成过，直接下载缓存的 blob
            if (currentData.epubBlob) {
                const filename = createBookExportFilename(
                    currentData.metadata.title,
                    "epub",
                    currentData.exportContext?.selection
                );
                try {
                    triggerDownload(currentData.epubBlob, filename);
                    recordSuccessfulExport("epub");
                    void recordBookExport("epub");
                } catch (error) {
                    console.error(error);
                    showExportFailure("EPUB", "download", error);
                }
                return;
            }

            btn.innerText = t("export.generating");
            btn.style.background = "#7ab8d6";

            document.title = t("export.documentTitle", { title: oldTitle });

            let blob: Blob;
            try {
                log(t("export.log.buildEpub"));
                blob = await buildEpub(currentData.chapters, currentData.metadata, getEpubTagPageSetting());
            } catch (error) {
                console.error(error);
                showExportFailure("EPUB", "generate", error);
                return;
            }
            currentData.epubBlob = blob;

            const filename = createBookExportFilename(
                currentData.metadata.title,
                "epub",
                currentData.exportContext?.selection
            );
            try {
                triggerDownload(blob, filename);
                recordSuccessfulExport("epub");
                void recordBookExport("epub");
            } catch (error) {
                console.error(error);
                showExportFailure("EPUB", "download", error);
            }
        } finally {
            epubExporting = false;
            btn.disabled = false;
            btn.style.background = originalBg;
            document.title = oldTitle;
            refreshFormatChoiceText();
        }
    }

    // 下载 HTML
    async function handleHtmlDownload() {
        if (htmlExporting) {
            return;
        }
        htmlExporting = true;
        const btn = document.querySelector("#esj-html") as HTMLButtonElement;
        try {
            btn.disabled = true;
            if (hasMappedChapters && !(await confirmMappingFontExport("HTML", mappingSummary))) {
                recordCancelledExport("html");
                return;
            }
            btn.innerText = t("export.generating");

            let blob: Blob;
            try {
                log(t("export.log.buildHtml"));
                blob = await buildHtml(data.chapters, data.metadata);
            } catch (error) {
                console.error(error);
                showExportFailure("HTML", "generate", error);
                return;
            }

            const filename = createBookExportFilename(data.metadata.title, "html", data.exportContext?.selection);
            try {
                triggerDownload(blob, filename);
                recordSuccessfulExport("html");
                void recordBookExport("html");
            } catch (error) {
                console.error(error);
                showExportFailure("HTML", "download", error);
            }
        } finally {
            htmlExporting = false;
            btn.disabled = false;
            refreshFormatChoiceText();
        }
    }

    function recordSuccessfulExport(format: "txt" | "epub" | "html"): void {
        recordBrowserDiagnosticExport({
            scope: "full",
            format,
            outcome: "success",
            generated: true,
            downloadTriggered: true,
            failureStage: null
        });
    }

    function recordCancelledExport(format: "epub" | "html"): void {
        recordBrowserDiagnosticExport({
            scope: "full",
            format,
            outcome: "cancelled",
            generated: false,
            downloadTriggered: false,
            failureStage: null
        });
    }

    function recordBookExport(format: "txt" | "epub" | "html"): Promise<void> {
        const context = data.exportContext;
        const imageInfo =
            format === "txt"
                ? undefined
                : {
                      enabled: context?.imageEnabled || false,
                      successCount: data.chapters.reduce((count, chapter) => count + (chapter.images?.length || 0), 0),
                      failureCount: data.chapters.reduce((count, chapter) => count + (chapter.imageErrors || 0), 0)
                  };
        return addDownloadHistory({
            ...(context?.bookId === undefined ? {} : { bookId: context.bookId }),
            bookName: context?.rawBookName || data.metadata.title || "未命名小说",
            author: data.metadata.author || "",
            format,
            sourcePageType: context?.sourcePageType || "detail",
            chapterSummary: context?.chapterSummary || {
                totalCount: data.chapters.length,
                missingCount: data.chapters.filter((chapter) => chapter.content.includes('class="esj-missing-chapter"'))
                    .length
            },
            ...(context?.selection === undefined ? {} : { selection: context.selection }),
            ...(imageInfo === undefined ? {} : { imageInfo }),
            pageUrl: context?.pageUrl || location.href
        });
    }
}

/**
 * 创建设置面板弹窗
 */
export function createSettingsPanel(): void {
    fullCleanup();

    // 设置面板打开时，自己就是设置，不需要禁用按钮
    toggleSettingsLock(true);

    const closeAction = () => {
        document.querySelector("#esj-settings")?.remove();
        toggleSettingsLock(false);
    };

    const header = createCommonHeader(`⚙️ ${t("settings.title")}`, closeAction);
    const settingsHeaderLabel = header.querySelector("span");
    if (settingsHeaderLabel instanceof HTMLElement) {
        settingsHeaderLabel.replaceChildren("⚙️ ", bindInterfaceText(el("span"), "settings.title"));
    }
    const installedVersion =
        typeof GM_info !== "undefined" && GM_info.script?.version?.trim()
            ? `v${GM_info.script.version.trim()}`
            : t("settings.versionUnknown");

    const interfaceLocalePreference = getInterfaceLocalePreference();
    const interfaceLocaleSelect = bindInterfaceAttribute(
        el(
            "select",
            {
                id: "esj-interface-language",
                style: "min-width: 150px; padding: 6px; border: 1px solid #ccc; border-radius: 4px;",
                onchange: (e: Event) => {
                    const value = (e.target as HTMLSelectElement).value;
                    if (isInterfaceLocalePreference(value)) {
                        setInterfaceLocalePreference(value);
                        publishInterfaceLocaleChange();
                    }
                }
            },
            [
                bindInterfaceText(
                    el("option", { value: "auto", selected: interfaceLocalePreference === "auto" }),
                    "settings.interfaceLanguage.auto"
                ),
                bindInterfaceText(
                    el("option", { value: "zh-CN", selected: interfaceLocalePreference === "zh-CN" }),
                    "settings.interfaceLanguage.simplified"
                ),
                bindInterfaceText(
                    el("option", { value: "zh-TW", selected: interfaceLocalePreference === "zh-TW" }),
                    "settings.interfaceLanguage.traditional"
                )
            ]
        ),
        "aria-label",
        "settings.interfaceLanguage"
    );

    // 并发数输入框
    const currentConcurrency = getConcurrency();
    const inputConcurrency = el("input", {
        id: "esj-settings-concurrency",
        type: "number",
        min: 1,
        max: 10,
        value: currentConcurrency,
        style: "width: 60px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; text-align: center;",
        oninput: (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target.value === "") {
                return;
            }
            let val = parseInt(target.value, 10);
            if (isNaN(val)) {
                return;
            }

            if (val > 10) {
                val = 10;
                target.value = "10";
            } else if (val < 1) {
                val = 1;
                target.value = "1";
            }

            setConcurrency(val);
            log(t("settings.log.concurrency", { count: val }));
        },
        onblur: (e: Event) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            if (isNaN(val) || target.value === "") {
                target.value = currentConcurrency.toString();
                setConcurrency(currentConcurrency);
                log(t("settings.log.concurrency", { count: currentConcurrency }));
            }
        }
    });

    const btnCacheManager = el(
        "button",
        {
            className: "btn btn-primary btn-sm esj-cache-manager-trigger",
            style: "color: white; min-width: 110px;",
            onclick: () => {
                document.querySelector("#esj-settings")?.remove();
                createCacheManagerPopup();
            }
        },
        [bindInterfaceText(el("span"), "settings.cache")]
    );

    const btnDownloadHistory = el(
        "button",
        {
            className: "btn btn-primary btn-sm",
            style: "color:white;min-width:110px;",
            onclick: () => {
                document.querySelector("#esj-settings")?.remove();
                createDownloadHistoryPopup();
            }
        },
        [bindInterfaceText(el("span"), "settings.history")]
    );

    const btnDiagnostics = el(
        "button",
        {
            className: "btn btn-primary btn-sm",
            style: "color:white;min-width:110px;",
            onclick: () => createDiagnosticPopup()
        },
        [bindInterfaceText(el("span"), "settings.diagnosticsButton")]
    );

    // 图片下载开关
    const isImageEnabled = getImageDownloadSetting();

    const checkboxInput = el("input", {
        id: "esj-settings-images",
        type: "checkbox",
        checked: isImageEnabled,
        onchange: async (e: Event) => {
            const input = e.target as HTMLInputElement;
            const checked = (e.target as HTMLInputElement).checked;
            const previous = getImageDownloadSetting();
            input.disabled = true;
            try {
                const activeTasks = await listActiveBookDownloadLocks();
                if (activeTasks.length > 0 && !(await confirmImageSettingChange(activeTasks.length))) {
                    input.checked = previous;
                    return;
                }
            } finally {
                input.disabled = false;
            }
            setImageDownloadSetting(checked);
            // 已有章节由后续任务按 imageEnabled 逐书判断，不在设置变更时全局清理
            log(
                t("settings.log.image", {
                    state: t(checked ? "diagnostics.summary.enabled" : "diagnostics.summary.disabled")
                })
            );
        }
    });

    const switchToggleImage = el("label", { className: "esj-switch" }, [
        checkboxInput,
        el("span", { className: "esj-slider" })
    ]);

    // EPUB 标签页开关
    const isEpubTagPageEnabled = getEpubTagPageSetting();
    const checkboxEpubTagPage = el("input", {
        id: "esj-settings-epub-tag-page",
        type: "checkbox",
        checked: isEpubTagPageEnabled,
        onchange: (e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            setEpubTagPageSetting(checked);

            if (state.cachedData) {
                state.cachedData.epubBlob = null;
            }

            log(
                t("settings.log.epubTag", {
                    state: t(checked ? "diagnostics.summary.enabled" : "diagnostics.summary.disabled")
                })
            );
        }
    });

    const switchToggleEpubTagPage = el("label", { className: "esj-switch" }, [
        checkboxEpubTagPage,
        el("span", { className: "esj-slider" })
    ]);

    log(
        t("settings.log.initialized", {
            concurrency: currentConcurrency,
            imageEnabled: isImageEnabled
        })
    );

    // 创建分隔线
    const createDivider = () => el("hr", { style: "margin: 15px 0; border: 0; border-top: 1px solid #eee;" });

    // 通用行样式
    const rowStyle = "display:flex; align-items:center; justify-content:space-between;";

    const rowConcurrency = el("div", { style: rowStyle }, [
        bindInterfaceText(el("label", { style: "color: #333;" }), "settings.concurrency", { max: 10 }),
        inputConcurrency
    ]);

    const rowInterfaceLanguage = el("div", { style: rowStyle }, [
        bindInterfaceText(el("label", { style: "color: #333;" }), "settings.interfaceLanguage"),
        interfaceLocaleSelect
    ]);

    const rowCache = el("div", { style: rowStyle }, [
        bindInterfaceText(el("label", { style: "color: #333;" }), "settings.cache"),
        btnCacheManager
    ]);

    const rowHistory = el("div", { style: rowStyle }, [
        bindInterfaceText(el("label", { style: "color:#333;" }), "settings.history"),
        btnDownloadHistory
    ]);

    const rowDiagnostics = el("div", { style: rowStyle }, [
        el("div", {}, [
            bindInterfaceText(el("label", { style: "color:#333;" }), "settings.diagnostics"),
            bindInterfaceText(
                el("div", { style: "font-size:12px;color:#999;margin-top:2px;" }),
                "settings.diagnosticsDescription"
            )
        ]),
        btnDiagnostics
    ]);

    const rowImage = el("div", { style: rowStyle }, [
        el("div", {}, [
            bindInterfaceText(el("label", { style: "color: #333;" }), "settings.imageDownload"),
            bindInterfaceText(
                el("div", { style: "font-size:12px; color:#999; margin-top: 2px;" }),
                "settings.imageDownloadDescription"
            )
        ]),
        switchToggleImage
    ]);

    const rowEpubTagPage = el("div", { style: rowStyle }, [
        el("div", {}, [
            bindInterfaceText(el("label", { style: "color: #333;" }), "settings.epubTagPage"),
            bindInterfaceText(
                el("div", { style: "font-size:12px; color:#999; margin-top: 2px;" }),
                "settings.epubTagPageDescription"
            )
        ]),
        switchToggleEpubTagPage
    ]);

    const relatedLinkStyle =
        "flex:1;display:block;padding:8px 6px;border-radius:6px;text-align:center;text-decoration:none;font-size:12px;font-weight:bold;";
    const btnGithub = el(
        "a",
        {
            href: "https://github.com/mikoto710/esj-novel-downloader",
            target: "_blank",
            rel: "noopener noreferrer",
            style: relatedLinkStyle + "background:#24292f;color:#fff;"
        },
        [bindInterfaceText(el("span"), "settings.github")]
    );
    const btnGreasyFork = el(
        "a",
        {
            href: "https://greasyfork.org/zh-CN/scripts/562046-esjzone-%E5%85%A8%E6%9C%AC%E4%B8%8B%E8%BD%BD",
            target: "_blank",
            rel: "noopener noreferrer",
            style: relatedLinkStyle + "background:#8b1a1a;color:#fff;"
        },
        [bindInterfaceText(el("span"), "settings.greasyFork")]
    );
    const btnIssue = el(
        "a",
        {
            href: "https://github.com/mikoto710/esj-novel-downloader/issues",
            target: "_blank",
            rel: "noopener noreferrer",
            style: relatedLinkStyle + "margin-top:8px;background:#f6f8fa;border:1px solid #d0d7de;color:#24292f;"
        },
        [bindInterfaceText(el("span"), "settings.feedback")]
    );
    const relatedLinks = el("div", { style: "text-align:center;" }, [
        bindInterfaceText(
            el("div", { style: "color:#333;font-weight:bold;margin-bottom:8px;" }),
            "settings.relatedLinks"
        ),
        el("div", { style: "display:flex;gap:8px;" }, [btnGithub, btnGreasyFork]),
        btnIssue,
        el("div", { style: "margin-top:12px;color:#999;font-size:12px;" }, [
            `ESJ Novel Downloader · ${installedVersion}`
        ])
    ]);

    // 组装整体面板
    const body = el("div", { style: "padding:25px 20px;font-size:14px;overflow:auto;min-height:0;" }, [
        rowConcurrency,
        createDivider(),
        rowInterfaceLanguage,
        createDivider(),
        rowImage,
        createDivider(),
        rowEpubTagPage,
        createDivider(),
        rowCache,
        createDivider(),
        rowHistory,
        createDivider(),
        rowDiagnostics,
        createDivider(),
        relatedLinks
    ]);

    const popup = el(
        "div",
        {
            id: "esj-settings",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;max-height:calc(100vh - 32px);background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:999999;display:flex;flex-direction:column;"
        },
        [header, body]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
}
