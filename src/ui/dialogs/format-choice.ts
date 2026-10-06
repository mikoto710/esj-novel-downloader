import {
    exportBookTxt,
    exportBookRich,
    getExportCapabilities,
    getExportImageSetting,
    type CachedData,
    type ExportFormat,
    type ExportFailureStage
} from "../../app/export";
import { state } from "../../app/page-session";
import { fullCleanup, enableDrag, el, registerElementCleanup, removeElement } from "../../utils/dom";
import { log } from "../../utils/log";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { createCommonHeader } from "./common";
import { showMessagePopup } from "./message";
import { confirmMappingFontExport } from "./mapping-font";

function formatMappingFontBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

let disposeActiveFormatLocaleRefresh: (() => void) | null = null;

function showExportFailure(format: ExportFormat, stage: ExportFailureStage, details: string): void {
    const stageText = t(stage === "generate" ? "export.stage.generate" : "export.stage.download");
    showMessagePopup({
        tone: "error",
        title: t("export.failure.title", { format: format.toUpperCase(), stage: stageText }),
        message: t("export.failure.message", { format: format.toUpperCase(), stage: stageText }),
        details
    });
}

/**
 * 显示 TXT、EPUB 和 HTML 格式选择弹窗
 */
export function showFormatChoice(data: CachedData): void {
    fullCleanup();
    disposeActiveFormatLocaleRefresh?.();

    const { mappingSummary, txtEnabled } = getExportCapabilities(data.chapters);
    const hasMappedChapters = !txtEnabled;

    const closeAction = () => {
        removeElement(popup);
    };

    const header = createCommonHeader(t("export.title"), closeAction);

    // 信息区展示当前导出快照的封面、插图和字体情况
    const coverStatus = data.metadata.coverBlob
        ? el("div", { id: "esj-format-cover-status", style: "color:green;font-size:12px;margin-top:4px;" }, [
              t("export.coverReady")
          ])
        : el("div", { id: "esj-format-cover-status", style: "color:red;font-size:12px;margin-top:4px;" }, [
              t("export.coverMissing")
          ]);

    const imageSuccessCount = data.chapters.reduce((count, chapter) => count + (chapter.images?.length || 0), 0);
    const imageFailureCount = data.chapters.reduce((count, chapter) => count + (chapter.imageErrors || 0), 0);
    const imageTotalCount = imageSuccessCount + imageFailureCount;
    const isImageDownloadEnabled = getExportImageSetting(data);
    const imageStatus = isImageDownloadEnabled
        ? el("div", {
              id: "esj-format-image-status",
              style: `color:${imageTotalCount === 0 ? "#999" : imageFailureCount > 0 ? "#e6a23c" : "#2b9bd7"};font-size:12px;margin-top:4px;`
          })
        : "";

    // 范围结果显示起止章序，全本结果显示总章数
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
        data.exportContext?.selection?.mode === "range"
            ? ""
            : el("div", { id: "esj-format-chapter-count", style: "color:#666;font-size:12px;margin-top:4px;" }, [
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

    // 每种格式独立防重，弹窗持有的结果不跟随后续任务变化
    const exporting = new Set<"epub" | "html">();

    // TXT 无法携带映射字体；EPUB 和 HTML 在各自按钮中生成富文本产物
    const btnTxt = el(
        "button",
        {
            id: "esj-txt",
            disabled: hasMappedChapters,
            "aria-disabled": hasMappedChapters ? "true" : "false",
            title: hasMappedChapters ? t("export.txtBlocked") : t("export.downloadTxt"),
            style: `flex:1;padding:10px 0;border:1px solid #ccc;background:#f0f0f0;border-radius:6px;cursor:${hasMappedChapters ? "not-allowed" : "pointer"};font-weight:bold;color:${hasMappedChapters ? "#999" : "#333"};`,
            onclick: hasMappedChapters ? undefined : () => exportBookTxt(data, { failed: showExportFailure })
        },
        [hasMappedChapters ? t("export.txtDisabled") : t("export.downloadTxt")]
    );

    const btnEpub = el(
        "button",
        {
            id: "esj-epub",
            style: "flex:1;padding:10px 0;border:none;background:#2b9bd7;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: () => handleRichDownload("epub", btnEpub)
        },
        [t("export.downloadEpub")]
    );

    const btnHtml = el(
        "button",
        {
            id: "esj-html",
            style: "flex:1;padding:10px 0;border:none;background:#999;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;",
            onclick: () => handleRichDownload("html", btnHtml)
        },
        [t("export.downloadHtml")]
    );

    // 三种格式并列展示，TXT 不可用的原因另放在按钮下方
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
    acquirePageActionGroupLockForPopup(popup);
    enableDrag(popup, ".esj-common-header");

    // 原地更新按钮文案，保留进行中的生成状态和事件绑定
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
            imageStatus.textContent =
                imageTotalCount > 0
                    ? `${t("export.images", { success: imageSuccessCount, total: imageTotalCount })}${
                          imageFailureCount > 0 ? t("export.imagesFailed", { count: imageFailureCount }) : ""
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
        btnEpub.textContent = t(exporting.has("epub") ? "export.generating" : "export.downloadEpub");
        btnHtml.textContent = t(exporting.has("html") ? "export.generating" : "export.downloadHtml");
        if (txtDisabledReason instanceof HTMLElement) {
            txtDisabledReason.textContent = t("download.export.txtDisabled");
        }
    };
    refreshFormatChoiceText();
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
    registerElementCleanup(popup, disposeLocaleRefresh);

    /**
     * 生成并导出所选格式，各格式独立防重并允许失败后重试
     */
    async function handleRichDownload(format: "epub" | "html", button: HTMLButtonElement): Promise<void> {
        if (exporting.has(format)) {
            return;
        }
        exporting.add(format);
        const originalBg = button.style.background;
        const oldTitle = document.title;
        try {
            button.disabled = true;
            await exportBookRich(data, format, {
                confirm: (format, summary) => confirmMappingFontExport(format === "epub" ? "EPUB" : "HTML", summary),
                generating: (format) => {
                    button.textContent = t("export.generating");
                    if (format === "epub") {
                        button.style.background = "#7ab8d6";
                        if (popup.isConnected) {
                            document.title = t("export.documentTitle", { title: oldTitle });
                        }
                    }
                    log(t(format === "epub" ? "export.log.buildEpub" : "export.log.buildHtml"));
                },
                failed: showExportFailure
            });
        } finally {
            exporting.delete(format);
            button.disabled = false;
            button.style.background = originalBg;
            if (
                format === "epub" &&
                (!state.activeDownload || state.activeDownload.taskId === data.exportContext?.taskId) &&
                (!disposeActiveFormatLocaleRefresh || disposeActiveFormatLocaleRefresh === disposeLocaleRefresh)
            ) {
                // 旧弹窗后台生成结束时，不覆盖后来任务或格式窗口的标题
                document.title = oldTitle;
            }
            refreshFormatChoiceText();
        }
    }
}
