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
    setEpubTagPageSetting
} from "../core/config";
import { buildHtml } from "../core/html";
import { createCacheManagerPopup } from "./cache-manager";
import { createDownloadHistoryPopup } from "./download-history";
import { addDownloadHistory } from "../core/download-history";
import type { MappingFontDetection, MappingFontSummary } from "../core/download/contracts";

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
    warning.textContent = `⚠ 已检测到 ${summary.chapterCount} 个映射章节，字体共 ${formatMappingFontBytes(summary.fontBytes)}。TXT 导出已禁用，HTML/EPUB 仅保证视觉显示。`;
}

/**
 * 首次检测到映射正文后要求用户明确同意，关闭弹窗等同停止下载
 */
export function confirmMappingFontDownload(detection: MappingFontDetection): Promise<boolean> {
    document.querySelector("#esj-mapping-confirm")?.remove();
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
        const header = createCommonHeader("⚠️ 检测到自定义映射字体", () => finish(false));
        const body = el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
            el("div", { style: "font-weight:bold;margin-bottom:8px;" }, [detection.task.title]),
            "该章节使用专属映射字体。继续下载后只能导出 HTML 或 EPUB；复制、搜索和朗读可能不正确，缓存及导出文件也会明显增大。",
            el("div", { style: "margin-top:8px;color:#8a5a00;font-size:13px;" }, [
                `当前检测到 ${detection.chapterCount} 章，字体 ${formatMappingFontBytes(detection.fontBytes)}。`
            ]),
            el(
                "div",
                {
                    id: "esj-mapping-inflight-warning",
                    style: "margin-top:10px;padding:8px 10px;border:1px solid #f0c36d;background:#fff8e5;color:#7a5200;border-radius:5px;font-size:13px;"
                },
                [
                    detection.inFlightLimit > 0
                        ? `已停止领取新章节。已经发出的请求仍会收尾，进度最多还可能增加 ${detection.inFlightLimit} 章；这不表示任务仍在继续领取章节。`
                        : "尚未发出新的章节请求；确认期间不会继续下载。"
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
                ["停止下载"]
            ),
            el(
                "button",
                {
                    id: "esj-mapping-continue",
                    style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
                    onclick: () => finish(true)
                },
                ["继续下载（仅 HTML/EPUB）"]
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
    });
}

/**
 * 映射字体补抓后仍失败时给出明确摘要，禁止静默进入导出
 */
export function showMappingFontFailure(failures: ReadonlyArray<{ task: { title: string }; message: string }>): void {
    const preview = failures
        .slice(0, 5)
        .map((failure) => `• ${failure.task.title}: ${failure.message}`)
        .join("\n");
    const remaining = failures.length > 5 ? `\n另有 ${failures.length - 5} 章未列出。` : "";
    alert(`有 ${failures.length} 个章节的映射字体无法解析，已阻止导出：\n${preview}${remaining}`);
}

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
                createCommonHeader(`⚠️ 确认生成 ${format}`, () => finish(false)),
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
                    `将嵌入 ${summary.chapterCount} 个章节字体，共 ${formatMappingFontBytes(summary.fontBytes)}。${format} 只能保证视觉显示，复制、搜索和朗读可能不正确。`
                ]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;" }, [
                    el(
                        "button",
                        {
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: () => finish(false)
                        },
                        ["返回"]
                    ),
                    el(
                        "button",
                        {
                            id: "esj-mapping-export-continue",
                            style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;",
                            onclick: () => finish(true)
                        },
                        [`继续生成 ${format}`]
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
 * 创建通用头部
 * @param title 标题
 * @param onClose 关闭回调
 * @param onMinimize (可选) 最小化回调，传了就会显示最小化按钮
 */
function createCommonHeader(title: string, onClose: () => void, onMinimize?: () => void): HTMLElement {
    const btnGroup: HTMLElement[] = [];

    // 最小化按钮
    if (onMinimize) {
        const btnMin = el(
            "button",
            {
                title: "最小化",
                style: "border:none;background:#81d4fa;color:#000;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;margin-right:5px;",
                onclick: onMinimize
            },
            ["＿"]
        );
        btnGroup.push(btnMin);
    }

    // 关闭按钮
    const btnClose = el(
        "button",
        {
            title: "关闭",
            style: "border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: onClose
        },
        ["✕"]
    );
    btnGroup.push(btnClose);

    // 容器
    return el(
        "div",
        {
            className: "esj-common-header",
            style: "padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;"
        },
        [el("span", { style: "font-weight:bold;" }, [title]), el("div", { style: "display:flex;" }, btnGroup)]
    );
}

/**
 * 提示同一本书已有跨页面全本下载任务，单章导出不使用此弹窗
 */
export function showBookDownloadInProgressPopup(lock: BookDownloadLock): void {
    document.querySelector("#esj-book-lock")?.remove();

    const sourceText = lock.sourcePageType === "detail" ? "详情页" : "论坛页";
    const closeAction = () => document.querySelector("#esj-book-lock")?.remove();
    const popup = el(
        "div",
        {
            id: "esj-book-lock",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:1000000;display:flex;flex-direction:column;"
        },
        [
            createCommonHeader("📘 下载任务进行中", closeAction),
            el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [
                `该书正在由${sourceText}发起全本下载，请等待任务完成或取消后再试。`
            ]),
            el("div", { style: "padding:12px;display:flex;justify-content:flex-end;" }, [
                el(
                    "button",
                    {
                        style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;",
                        onclick: closeAction
                    },
                    ["知道了"]
                )
            ])
        ]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
}

/**
 * 创建下载进度弹窗
 * 包含进度条、日志输出框、取消和最小化按钮
 */
export function createDownloadPopup(): HTMLElement {
    fullCleanup(state.originalTitle);

    toggleSettingsLock(true);

    function onCancel() {
        abortActiveDownload();
        const btn = document.querySelector("#esj-cancel") as HTMLButtonElement;
        if (btn) {
            btn.disabled = true;
            btn.textContent = "正在保存...";
            btn.style.backgroundColor = "#999";
        }
        log("🛑 正在停止任务，请稍候...");
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
        const statusText = headerTitle.replace(/^📘\s*/, "").trim() || "下载中...";

        createMinimizedTray(statusText);
    }

    const header = createCommonHeader("📘 全本下载任务", onClose, onMinimize);

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
        ["取消任务"]
    );

    const popup = el(
        "div",
        {
            id: "esj-popup",
            style: "position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 520px; height:min(460px,calc(100vh - 32px)); background: #fff; border-radius: 8px; border: 1px solid #aaa; box-shadow: 0 0 18px rgba(0,0,0,0.28); z-index: 999999; display:flex;flex-direction:column;"
        },
        [
            header,
            el("div", { style: "padding:12px;" }, [
                el("div", { style: "font-size:13px;margin-bottom:8px;" }, ["进度："]),
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
        (cachedCount > 0
            ? `检测到已有 ${cachedCount} 章缓存，点击确定将跳过已下载章节继续下载。`
            : "是否开始抓取该小说全部章节？");

    const closeAction = () => {
        document.querySelector("#esj-confirm")?.remove();
        toggleSettingsLock(false);
        if (onCancel) {
            onCancel();
        }
    };

    const header = createCommonHeader("✔️ 确认下载", closeAction);

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
        ["取消"]
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
        ["确定"]
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
        alert("暂无数据");
        return;
    }

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
        document.querySelector("#esj-format")?.remove();
        toggleSettingsLock(false);
        toggleDownloadLock(false);
    };

    const header = createCommonHeader("💾 导出选项", closeAction);

    const coverStatus = data.metadata.coverBlob
        ? el("div", { style: "color:green;font-size:12px;margin-top:4px;" }, ["✔  封面已就绪"])
        : el("div", { style: "color:red;font-size:12px;margin-top:4px;" }, ["✖  无封面"]);

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
            const errorHint = failCount > 0 ? ` (失败 ${failCount} 张，原因见 F12)` : "";

            imageStatus = el("div", { style: `color:${color}; font-size:12px; margin-top:4px;` }, [
                `🖼️ 正文插图: ${successCount} / ${totalCount} 张${errorHint}`
            ]);
        } else {
            // 开启了开关但没抓到任何图
            imageStatus = el("div", { style: "color:#999; font-size:12px; margin-top:4px;" }, [
                "🖼️ 正文插图: 未检测到图片"
            ]);
        }
    }

    const infoBody = el("div", { style: "padding:20px;font-size:14px;line-height:1.5;" }, [
        el("div", {}, [`《${data.metadata.title}》内容已就绪。`]),
        el("div", { style: "color:#666;font-size:12px;margin-top:4px;" }, [`共 ${data.chapters.length} 章`]),
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
                      `⚠ 检测到 ${mappingSummary.chapterCount} 个映射章节，字体共 ${formatMappingFontBytes(mappingSummary.fontBytes)}。TXT 已禁用；HTML/EPUB 仅保证视觉显示，复制、搜索和朗读可能不正确。`
                  ]
              )
            : ""
    ]);

    const btnTxt = el(
        "button",
        {
            id: "esj-txt",
            disabled: hasMappedChapters,
            "aria-disabled": hasMappedChapters ? "true" : "false",
            title: hasMappedChapters ? "映射正文尚未恢复为真实 Unicode，无法生成正确 TXT" : "下载 TXT",
            style: `flex:1;padding:10px 0;border:1px solid #ccc;background:#f0f0f0;border-radius:6px;cursor:${hasMappedChapters ? "not-allowed" : "pointer"};font-weight:bold;color:${hasMappedChapters ? "#999" : "#333"};`,
            onclick: hasMappedChapters
                ? undefined
                : () => {
                      const filename = (data.metadata.title || "book") + ".txt";
                      const blob = new Blob([data.txt], { type: "text/plain;charset=utf-8" });
                      triggerDownload(blob, filename);
                      void recordBookExport("txt");
                  }
        },
        [hasMappedChapters ? "TXT 不可用" : "⬇ TXT 下载"]
    );

    const btnEpub = el(
        "button",
        {
            id: "esj-epub",
            style: "flex:1;padding:10px 0;border:none;background:#2b9bd7;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: async () => handleEpubDownload()
        },
        ["⬇ EPUB 下载"]
    );

    const btnHtml = el(
        "button",
        {
            id: "esj-html",
            style: "flex:1;padding:10px 0;border:none;background:#999;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: async () => handleHtmlDownload()
        },
        ["⬇ HTML 下载"]
    );

    const footer = el(
        "div",
        {
            style: "display:flex;gap:15px;justify-content:center;padding:0 20px 15px 20px;"
        },
        [btnTxt, btnEpub, btnHtml]
    );
    const txtDisabledReason = hasMappedChapters
        ? el("div", { style: "padding:0 20px 16px;color:#a45b00;font-size:12px;line-height:1.5;" }, [
              "TXT 已禁用：映射正文尚未恢复为真实 Unicode。"
          ])
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

    // 下载 EPUB
    async function handleEpubDownload() {
        const btn = document.querySelector("#esj-epub") as HTMLButtonElement;
        const currentData = state.cachedData as CachedData;
        if (hasMappedChapters && !(await confirmMappingFontExport("EPUB", mappingSummary))) {
            return;
        }

        // 如果已经生成过，直接下载缓存的 blob
        if (currentData.epubBlob) {
            const filename = (currentData.metadata.title || "book") + ".epub";
            triggerDownload(currentData.epubBlob, filename);
            void recordBookExport("epub");
            return;
        }

        const originalText = btn.innerText;
        const originalBg = btn.style.background;
        const oldTitle = document.title;
        try {
            btn.innerText = "生成中...";
            btn.disabled = true;
            btn.style.background = "#7ab8d6";

            const oldTitle = document.title;
            document.title = "[生成 EPUB] " + oldTitle;

            const blob = await buildEpub(currentData.chapters, currentData.metadata, getEpubTagPageSetting());
            currentData.epubBlob = blob;

            const filename = (currentData.metadata.title || "book") + ".epub";
            triggerDownload(blob, filename);
            void recordBookExport("epub");
        } catch (e: any) {
            console.error(e);
            alert("EPUB 生成失败: " + e.message);
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.background = originalBg;
            document.title = oldTitle;
        }
    }

    // 下载 HTML
    async function handleHtmlDownload() {
        const btn = document.querySelector("#esj-html") as HTMLButtonElement;
        if (hasMappedChapters && !(await confirmMappingFontExport("HTML", mappingSummary))) {
            return;
        }
        const originalText = btn.innerText;
        try {
            btn.innerText = "生成中...";
            btn.disabled = true;

            const blob = await buildHtml(data.chapters, data.metadata);

            const filename = (data.metadata.title || "book") + ".html";
            triggerDownload(blob, filename);
            void recordBookExport("html");
        } catch (e: any) {
            console.error(e);
            alert("HTML 生成失败: " + e.message);
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
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
            bookId: context?.bookId,
            bookName: context?.rawBookName || data.metadata.title || "未命名小说",
            author: data.metadata.author || "",
            format,
            sourcePageType: context?.sourcePageType || "detail",
            chapterInfo: context?.chapterInfo || `${data.chapters.length} 章`,
            imageInfo,
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

    const header = createCommonHeader("⚙️ 脚本设置", closeAction);
    const installedVersion =
        typeof GM_info !== "undefined" && GM_info.script?.version?.trim()
            ? `v${GM_info.script.version.trim()}`
            : "版本未知";

    // 并发数输入框
    const currentConcurrency = getConcurrency();
    const inputConcurrency = el("input", {
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
        },
        onblur: (e: Event) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            if (isNaN(val) || target.value === "") {
                target.value = currentConcurrency.toString();
                setConcurrency(currentConcurrency);
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
        ["缓存管理"]
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
        ["下载记录"]
    );

    // 图片下载开关
    const isImageEnabled = getImageDownloadSetting();

    const checkboxInput = el("input", {
        type: "checkbox",
        checked: isImageEnabled,
        onchange: (e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            setImageDownloadSetting(checked);
            // 已有章节由后续任务按 imageEnabled 逐书判断，不在设置变更时全局清理
            log(`正文图片下载已${checked ? "开启" : "关闭"}`);
        }
    });

    const switchToggleImage = el("label", { className: "esj-switch" }, [
        checkboxInput,
        el("span", { className: "esj-slider" })
    ]);

    // EPUB 标签页开关
    const isEpubTagPageEnabled = getEpubTagPageSetting();
    const checkboxEpubTagPage = el("input", {
        type: "checkbox",
        checked: isEpubTagPageEnabled,
        onchange: (e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            setEpubTagPageSetting(checked);

            if (state.cachedData) {
                state.cachedData.epubBlob = null;
            }

            log(`EPUB 标签页已${checked ? "开启" : "关闭"}`);
        }
    });

    const switchToggleEpubTagPage = el("label", { className: "esj-switch" }, [
        checkboxEpubTagPage,
        el("span", { className: "esj-slider" })
    ]);

    log(`初始化参数：并发数=${currentConcurrency}，图片下载=${isImageEnabled}`);

    // 创建分隔线
    const createDivider = () => el("hr", { style: "margin: 15px 0; border: 0; border-top: 1px solid #eee;" });

    // 通用行样式
    const rowStyle = "display:flex; align-items:center; justify-content:space-between;";

    const rowConcurrency = el("div", { style: rowStyle }, [
        el("label", { style: "color: #333;" }, ["下载线程数 (1-10):"]),
        inputConcurrency
    ]);

    const rowCache = el("div", { style: rowStyle }, [
        el("label", { style: "color: #333;" }, ["下载缓存:"]),
        btnCacheManager
    ]);

    const rowHistory = el("div", { style: rowStyle }, [
        el("label", { style: "color:#333;" }, ["下载记录:"]),
        btnDownloadHistory
    ]);

    const rowImage = el("div", { style: rowStyle }, [
        el("div", {}, [
            el("label", { style: "color: #333;" }, ["下载正文插图: "]),
            el("div", { style: "font-size:12px; color:#999; margin-top: 2px;" }, ["(会让速度变慢、体积变大)"])
        ]),
        switchToggleImage
    ]);

    const rowEpubTagPage = el("div", { style: rowStyle }, [
        el("div", {}, [
            el("label", { style: "color: #333;" }, ["生成 EPUB 标签页: "]),
            el("div", { style: "font-size:12px; color:#999; margin-top: 2px;" }, ["(关闭后标签仍会写入 EPUB 元数据)"])
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
        ["GitHub 项目主页"]
    );
    const btnGreasyFork = el(
        "a",
        {
            href: "https://greasyfork.org/zh-CN/scripts/562046-esjzone-%E5%85%A8%E6%9C%AC%E4%B8%8B%E8%BD%BD",
            target: "_blank",
            rel: "noopener noreferrer",
            style: relatedLinkStyle + "background:#8b1a1a;color:#fff;"
        },
        ["GreasyFork 脚本页"]
    );
    const btnIssue = el(
        "a",
        {
            href: "https://github.com/mikoto710/esj-novel-downloader/issues",
            target: "_blank",
            rel: "noopener noreferrer",
            style: relatedLinkStyle + "margin-top:8px;background:#f6f8fa;border:1px solid #d0d7de;color:#24292f;"
        },
        ["反馈问题 / Issues"]
    );
    const relatedLinks = el("div", { style: "text-align:center;" }, [
        el("div", { style: "color:#333;font-weight:bold;margin-bottom:8px;" }, ["相关链接"]),
        el("div", { style: "display:flex;gap:8px;" }, [btnGithub, btnGreasyFork]),
        btnIssue,
        el("div", { style: "margin-top:12px;color:#999;font-size:12px;" }, [
            `ESJ Novel Downloader · ${installedVersion}`
        ])
    ]);

    // 组装整体面板
    const body = el("div", { style: "padding: 25px 20px; font-size: 14px;" }, [
        rowConcurrency,
        createDivider(),
        rowImage,
        createDivider(),
        rowEpubTagPage,
        createDivider(),
        rowCache,
        createDivider(),
        rowHistory,
        createDivider(),
        relatedLinks
    ]);

    const popup = el(
        "div",
        {
            id: "esj-settings",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:999999;display:flex;flex-direction:column;"
        },
        [header, body]
    );

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
}
