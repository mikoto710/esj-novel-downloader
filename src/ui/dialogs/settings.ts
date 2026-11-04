import { state } from "../../app/page-session";
import { invalidateCachedEpub } from "../../app/export";
import {
    getConcurrency,
    setConcurrency,
    setImageDownloadSetting,
    getImageDownloadSetting,
    getEpubTagPageSetting,
    setEpubTagPageSetting,
    getInterfaceLocalePreference,
    setInterfaceLocalePreference
} from "../../storage/settings";
import { isInterfaceLocalePreference, type InterfaceLocalePreference } from "../../locale/catalog";
import { listActiveBookDownloadLocks } from "../../storage/book-lock";
import { fullCleanup, enableDrag, el, removeElement } from "../dom";
import { log } from "../../ui/log-view";
import { bindInterfaceAttribute, bindInterfaceText, publishInterfaceLocaleChange, t } from "../locale";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";
import { createCommonHeader, showDecisionDialog } from "./common";
import { createCacheManagerPopup } from "./cache-manager";
import { createDownloadHistoryPopup } from "./download-history";
import { createDiagnosticPopup } from "./diagnostics";
import { showMessagePopup } from "./message";

const SETTINGS_ROW_STYLE = "display:flex; align-items:center; justify-content:space-between;";

function reportSettingsStorageFailure(error: unknown): void {
    console.error("设置读写失败", error);
    showMessagePopup({ tone: "error", message: t("settings.storageFailed") });
}

function saveSettingsChange(save: () => void, restore: () => void): boolean {
    try {
        save();
        return true;
    } catch (error) {
        restore();
        reportSettingsStorageFailure(error);
        return false;
    }
}

function confirmImageSettingChange(activeTaskCount: number, owner: Element): Promise<boolean> {
    const options = { dismissed: false, owner, focus: "#esj-image-setting-task-confirm-cancel" };
    return showDecisionDialog(options, (finish) => {
        return el(
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
    });
}

function createInterfaceLanguageRow(initialPreference: InterfaceLocalePreference): HTMLElement {
    let interfaceLocalePreference = initialPreference;

    // 语言选择立即保存并通知已打开的界面刷新
    function changeInterfaceLanguage(e: Event): void {
        const target = e.target as HTMLSelectElement;
        const value = target.value;
        if (isInterfaceLocalePreference(value)) {
            if (
                !saveSettingsChange(
                    () => setInterfaceLocalePreference(value),
                    () => {
                        target.value = interfaceLocalePreference;
                    }
                )
            ) {
                return;
            }
            interfaceLocalePreference = value;
            publishInterfaceLocaleChange();
        }
    }

    const interfaceLocaleSelect = bindInterfaceAttribute(
        el(
            "select",
            {
                id: "esj-interface-language",
                style: "min-width: 150px; padding: 6px; border: 1px solid #ccc; border-radius: 4px;",
                onchange: changeInterfaceLanguage
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

    return el("div", { style: SETTINGS_ROW_STYLE }, [
        bindInterfaceText(el("label", { style: "color: #333;" }), "settings.interfaceLanguage"),
        interfaceLocaleSelect
    ]);
}

function createConcurrencyRow(initialConcurrency: number): HTMLElement {
    let currentConcurrency = initialConcurrency;

    function changeConcurrency(e: Event): void {
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

        if (
            !saveSettingsChange(
                () => setConcurrency(val),
                () => {
                    target.value = currentConcurrency.toString();
                }
            )
        ) {
            return;
        }
        currentConcurrency = val;
        log(t("settings.log.concurrency", { count: val }));
    }

    function restoreEmptyConcurrency(e: Event): void {
        const target = e.target as HTMLInputElement;
        const val = parseInt(target.value, 10);
        if (isNaN(val) || target.value === "") {
            target.value = currentConcurrency.toString();
            if (
                !saveSettingsChange(
                    () => setConcurrency(currentConcurrency),
                    () => undefined
                )
            ) {
                return;
            }
            log(t("settings.log.concurrency", { count: currentConcurrency }));
        }
    }

    const inputConcurrency = el("input", {
        id: "esj-settings-concurrency",
        type: "number",
        min: 1,
        max: 10,
        value: currentConcurrency,
        style: "width: 60px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; text-align: center;",
        oninput: changeConcurrency,
        onblur: restoreEmptyConcurrency
    });

    return el("div", { style: SETTINGS_ROW_STYLE }, [
        bindInterfaceText(el("label", { style: "color: #333;" }), "settings.concurrency", { max: 10 }),
        inputConcurrency
    ]);
}

function createImageDownloadRow(initiallyEnabled: boolean): HTMLElement {
    let isImageEnabled = initiallyEnabled;

    // 读当前设置 → 核对活动任务并确认 → 保存；失败恢复面板最后确认值，finally 解锁控件
    async function changeImageDownloadSetting(e: Event): Promise<void> {
        const input = e.target as HTMLInputElement;
        const checked = (e.target as HTMLInputElement).checked;

        // 读取也可能失败，先保留本面板最后确认的值作为回退
        let previous = isImageEnabled;

        // 等跨页任务确认后再保存设置；取消时恢复原开关
        input.disabled = true;
        try {
            previous = getImageDownloadSetting();
            isImageEnabled = previous;
            const activeTasks = await listActiveBookDownloadLocks();
            const panel = input.closest("#esj-settings");
            if (
                !panel?.isConnected ||
                (activeTasks.length > 0 && !(await confirmImageSettingChange(activeTasks.length, panel)))
            ) {
                input.checked = previous;
                return;
            }
            setImageDownloadSetting(checked);
            isImageEnabled = checked;
        } catch (error) {
            input.checked = previous;
            reportSettingsStorageFailure(error);
            return;
        } finally {
            input.disabled = false;
        }

        // 已有章节由后续任务按 imageEnabled 逐书判断，不在设置变更时全局清理
        log(
            t("settings.log.image", {
                state: t(checked ? "diagnostics.summary.enabled" : "diagnostics.summary.disabled")
            })
        );
    }

    const checkboxInput = el("input", {
        id: "esj-settings-images",
        type: "checkbox",
        checked: isImageEnabled,
        onchange: changeImageDownloadSetting
    });

    const switchToggleImage = el("label", { className: "esj-switch" }, [
        checkboxInput,
        el("span", { className: "esj-slider" })
    ]);

    return el("div", { style: SETTINGS_ROW_STYLE }, [
        el("div", {}, [
            bindInterfaceText(el("label", { style: "color: #333;" }), "settings.imageDownload"),
            bindInterfaceText(
                el("div", { style: "font-size:12px; color:#999; margin-top: 2px;" }),
                "settings.imageDownloadDescription"
            )
        ]),
        switchToggleImage
    ]);
}

function createEpubTagPageRow(initiallyEnabled: boolean): HTMLElement {
    let isEpubTagPageEnabled = initiallyEnabled;

    function changeEpubTagPageSetting(e: Event): void {
        const target = e.target as HTMLInputElement;
        const checked = target.checked;
        if (
            !saveSettingsChange(
                () => setEpubTagPageSetting(checked),
                () => {
                    target.checked = isEpubTagPageEnabled;
                }
            )
        ) {
            return;
        }
        isEpubTagPageEnabled = checked;

        // 标签页改变后需重新生成 EPUB，已有正文结果继续复用
        invalidateCachedEpub(state.cachedData);

        log(
            t("settings.log.epubTag", {
                state: t(checked ? "diagnostics.summary.enabled" : "diagnostics.summary.disabled")
            })
        );
    }

    const checkboxEpubTagPage = el("input", {
        id: "esj-settings-epub-tag-page",
        type: "checkbox",
        checked: isEpubTagPageEnabled,
        onchange: changeEpubTagPageSetting
    });

    const switchToggleEpubTagPage = el("label", { className: "esj-switch" }, [
        checkboxEpubTagPage,
        el("span", { className: "esj-slider" })
    ]);

    return el("div", { style: SETTINGS_ROW_STYLE }, [
        el("div", {}, [
            bindInterfaceText(el("label", { style: "color: #333;" }), "settings.epubTagPage"),
            bindInterfaceText(
                el("div", { style: "font-size:12px; color:#999; margin-top: 2px;" }),
                "settings.epubTagPageDescription"
            )
        ]),
        switchToggleEpubTagPage
    ]);
}

/**
 * 创建设置面板弹窗
 */
export function createSettingsPanel(): void {
    fullCleanup();

    const closeAction = () => {
        removeElement(popup);
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

    // 先读取设置初值，供设置行和初始化日志共同使用
    const interfaceLocalePreference = getInterfaceLocalePreference();
    const currentConcurrency = getConcurrency();
    const isImageEnabled = getImageDownloadSetting();
    const isEpubTagPageEnabled = getEpubTagPageSetting();

    // 每行独立管理控件、保存结果和失败恢复
    const rowInterfaceLanguage = createInterfaceLanguageRow(interfaceLocalePreference);
    const rowConcurrency = createConcurrencyRow(currentConcurrency);
    const rowImage = createImageDownloadRow(isImageEnabled);
    const rowEpubTagPage = createEpubTagPageRow(isEpubTagPageEnabled);

    log(
        t("settings.log.initialized", {
            concurrency: currentConcurrency,
            imageEnabled: isImageEnabled
        })
    );

    // 创建分隔线
    const createDivider = () => el("hr", { style: "margin: 15px 0; border: 0; border-top: 1px solid #eee;" });

    // 子面板接管页面操作锁；诊断入口由诊断窗口自身关闭设置面板
    const btnCacheManager = el(
        "button",
        {
            className: "btn btn-primary btn-sm esj-cache-manager-trigger",
            style: "color: white; min-width: 110px;",
            onclick: () => {
                removeElement(popup);
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
                removeElement(popup);
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

    const rowCache = el("div", { style: SETTINGS_ROW_STYLE }, [
        bindInterfaceText(el("label", { style: "color: #333;" }), "settings.cache"),
        btnCacheManager
    ]);

    const rowHistory = el("div", { style: SETTINGS_ROW_STYLE }, [
        bindInterfaceText(el("label", { style: "color:#333;" }), "settings.history"),
        btnDownloadHistory
    ]);

    const rowDiagnostics = el("div", { style: SETTINGS_ROW_STYLE }, [
        el("div", {}, [
            bindInterfaceText(el("label", { style: "color:#333;" }), "settings.diagnostics"),
            bindInterfaceText(
                el("div", { style: "font-size:12px;color:#999;margin-top:2px;" }),
                "settings.diagnosticsDescription"
            )
        ]),
        btnDiagnostics
    ]);

    // 外部项目链接和当前脚本版本集中放在面板末尾
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

    // 设置正文独立滚动，标题始终可见
    const body = el("div", { style: "padding:25px 20px;font-size:14px;overflow:auto;min-height:0;" }, [
        // 下载和界面选项
        rowConcurrency,
        createDivider(),
        rowInterfaceLanguage,
        createDivider(),
        rowImage,
        createDivider(),
        rowEpubTagPage,
        createDivider(),

        // 缓存、历史和诊断管理入口
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
    acquirePageActionGroupLockForPopup(popup);
    enableDrag(popup, ".esj-common-header");
}
