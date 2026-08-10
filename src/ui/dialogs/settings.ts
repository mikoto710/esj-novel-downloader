import { state } from "../../core/state";
import {
    getConcurrency,
    setConcurrency,
    setImageDownloadSetting,
    getImageDownloadSetting,
    getEpubTagPageSetting,
    setEpubTagPageSetting,
    getInterfaceLocalePreference,
    setInterfaceLocalePreference
} from "../../core/config";
import { isInterfaceLocalePreference } from "../../core/locale";
import { listActiveBookDownloadLocks } from "../../core/book-lock";
import { fullCleanup, enableDrag, el } from "../../utils/dom";
import { log } from "../../utils/index";
import { bindInterfaceAttribute, bindInterfaceText, publishInterfaceLocaleChange, t } from "../locale";
import { createCommonHeader } from "./common";
import { createCacheManagerPopup } from "./cache-manager";
import { createDownloadHistoryPopup } from "./download-history";
import { createDiagnosticPopup } from "./diagnostics";

/**
 * 锁定/解锁页面上的设置按钮
 * @param locked true=禁用, false=启用
 */
function toggleSettingsLock(locked: boolean) {
    const btns = document.querySelectorAll(".esj-settings-trigger");
    btns.forEach((b) => ((b as HTMLButtonElement).disabled = locked));
}

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
