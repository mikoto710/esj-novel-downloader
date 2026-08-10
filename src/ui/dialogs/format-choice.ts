import { state } from "../../core/state";
import type { CachedData } from "../../types";
import type { MappingFontSummary } from "../../core/download/contracts";
import { buildEpub } from "../../core/epub";
import { buildHtml } from "../../core/html";
import { getEpubTagPageSetting, getImageDownloadSetting } from "../../core/config";
import { addDownloadHistory } from "../../core/download-history";
import { MappingFontError } from "../../core/mapping-font";
import { createBookExportFilename } from "../../core/download/export-filename";
import { recordBrowserDiagnosticExport, recordBrowserDiagnosticFailure } from "../../adapters/browser-diagnostics";
import { fullCleanup, enableDrag, el } from "../../utils/dom";
import { triggerDownload } from "../../utils/download";
import { log } from "../../utils/log";
import { acquirePageActionGroupLock } from "../page-action-lock";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { formatMappingFontError } from "../messages/mapping-font";
import { createCommonHeader } from "./common";
import { showMessagePopup } from "./message";
import { confirmMappingFontExport } from "./mapping-font";

function formatMappingFontBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const MAX_EXPORT_ERROR_DETAIL_LENGTH = 2_000;
const diagnosticExportFormat = { TXT: "txt", EPUB: "epub", HTML: "html" } as const;
type ExportFailureStage = "generate" | "download";
let disposeActiveFormatLocaleRefresh: (() => void) | null = null;
let releaseActiveFormatPageActions: (() => void) | null = null;

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
 * 显示 TXT、EPUB 和 HTML 格式选择弹窗
 */
export function showFormatChoice(): void {
    if (!state.cachedData) {
        showMessagePopup({ tone: "info", title: t("export.none.title"), message: t("export.none.message") });
        return;
    }

    disposeActiveFormatLocaleRefresh?.();
    releaseActiveFormatPageActions?.();
    releaseActiveFormatPageActions = null;
    fullCleanup();

    // 格式弹窗和下载入口分别持锁，任务返回时不会提前解锁本弹窗
    const releasePageActions = acquirePageActionGroupLock();
    releaseActiveFormatPageActions = releasePageActions;

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
        if (releaseActiveFormatPageActions === releasePageActions) {
            releaseActiveFormatPageActions = null;
        }
        releasePageActions();
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
