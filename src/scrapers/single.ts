import { blobToBase64 } from "../utils/index";
import { parseChapterHtml, parseBookMetadata } from "../core/parser";
import { getImageDownloadSetting } from "../core/config";
import { processHtmlImages } from "../utils/image";
import { addDownloadHistory } from "../core/download-history";
import { MappingFontError, normalizeChapterMappingFont, prepareChapterMappingExport } from "../core/mapping-font";
import { confirmMappingFontExport } from "../ui/popups";
import { showMessagePopup } from "../ui/message-popup";
import { t } from "../ui/locale";
import { isProtectedChapterHtml } from "../adapters/browser-protected-chapter";
import {
    browserDiagnosticLog as log,
    finishBrowserSingleChapterDiagnosticSession,
    recordBrowserDiagnosticExport,
    recordBrowserDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSessionMetadata
} from "../adapters/browser-diagnostics";

/**
 * 抓取并下载当前单章节页面
 */
export async function downloadCurrentPage(format: "txt" | "html" = "txt"): Promise<void> {
    const viewAllBtn = document.querySelector(".entry-navigation .view-all") as HTMLAnchorElement | null;
    const bookId =
        viewAllBtn?.href.match(/\/detail\/(\d+)/)?.[1] || location.pathname.match(/\/forum\/(\d+)\//)?.[1] || "unknown";
    const diagnosticTaskId = `single-${bookId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let diagnosticResult: "success" | "cancelled" | "failed" = "failed";
    let generated = false;
    let downloadTriggered = false;

    startBrowserDiagnosticSession(
        {
            taskId: diagnosticTaskId,
            bookId,
            bookTitle: document.title.split(" - ")[0] || "未命名小说",
            pageUrl: location.href,
            sourcePageType: "single",
            totalChapters: 1,
            imageEnabled: getImageDownloadSetting()
        },
        // 单章导出不覆盖全本任务的会话指针
        { rememberForLaterFailures: false }
    );

    try {
        log(t("single.log.started", { format: format.toUpperCase() }));

        let metaHeader = "";
        let bookNamePrefix = "";
        const htmlMeta = { intro: "", bookName: "", author: "" };

        if (viewAllBtn && viewAllBtn.href) {
            try {
                log(t("single.log.metadata"));
                const resp = await fetch(viewAllBtn.href);
                const html = await resp.text();
                const doc = new DOMParser().parseFromString(html, "text/html");

                const meta = parseBookMetadata(doc, viewAllBtn.href);

                updateBrowserDiagnosticSessionMetadata(diagnosticTaskId, {
                    bookName: meta.rawBookName || meta.bookName,
                    pageUrl: location.href,
                    sourcePageType: "single"
                });

                metaHeader = meta.introTxt + "====================================\n\n";
                bookNamePrefix = `[${meta.bookName}] `;

                htmlMeta.intro = meta.baseIntroTxt;
                htmlMeta.bookName = meta.bookName;
                htmlMeta.author = meta.author;
            } catch {
                console.warn("书籍元数据获取失败，仅下载正文");
            }
        }

        const html = document.documentElement.outerHTML;
        const defaultTitle = document.title.split(" - ")[0] || "未命名章节";
        if (isProtectedChapterHtml(html)) {
            log(t("protected.single.log", { title: defaultTitle }));
            showMessagePopup({
                tone: "warning",
                title: t("protected.single.title"),
                message: t("protected.single.message")
            });
            diagnosticResult = "cancelled";
            return;
        }

        const parsed = parseChapterHtml(html, defaultTitle);

        let normalized;
        try {
            normalized = await normalizeChapterMappingFont({
                title: parsed.title,
                content: parsed.contentHtml,
                txtSegment: `${parsed.title}\n\n${parsed.author}\n\n${parsed.contentText}\n\n`
            });
        } catch (error) {
            if (error instanceof MappingFontError) {
                recordBrowserDiagnosticFailure(
                    {
                        scope: "chapter",
                        stage: "mapping-font",
                        code: error.name || "mapping-font-error",
                        message: error.message,
                        chapter: { index: 0, title: parsed.title, url: location.href }
                    },
                    diagnosticTaskId
                );
                showMessagePopup({
                    tone: "error",
                    title: t("mapping.failure.title"),
                    message: t("single.mappingFailure.message"),
                    details: error.message
                });
                return;
            }
            throw error;
        }
        if (format === "txt" && normalized.kind === "mapped") {
            diagnosticResult = "cancelled";
            showMessagePopup({
                tone: "warning",
                title: t("mapping.single.txtUnavailable"),
                message: t("single.txtUnavailable.message")
            });
            return;
        }
        if (
            format === "html" &&
            normalized.kind === "mapped" &&
            !(await confirmMappingFontExport("HTML", {
                chapterCount: 1,
                fontBytes: normalized.chapter.mappingFont?.blob.size || 0
            }))
        ) {
            diagnosticResult = "cancelled";
            return;
        }

        const title = parsed.title;
        const author = htmlMeta.author || parsed.author;
        const contentText = parsed.contentText;
        let contentHtml = normalized.chapter.content;
        const imageEnabled = getImageDownloadSetting();
        let imageSuccessCount = 0;
        let imageFailureCount = 0;

        // 根据格式检查内容
        if (format === "txt" && !contentText) {
            recordBrowserDiagnosticFailure(
                {
                    scope: "chapter",
                    stage: "parse",
                    code: "chapter-content-missing",
                    message: "chapter-content-missing",
                    chapter: { index: 0, title, url: location.href }
                },
                diagnosticTaskId
            );
            showMessagePopup({
                tone: "warning",
                title: t("single.bodyMissing.title"),
                message: t("single.bodyMissing.message")
            });
            return;
        } else {
            if (imageEnabled) {
                log(t("single.log.images"));
                try {
                    const processed = await processHtmlImages(contentHtml, 0);

                    let tempHtml = processed.processedHtml;

                    for (const img of processed.images) {
                        const b64 = await blobToBase64(img.blob);
                        tempHtml = tempHtml.split(`src="${img.id}"`).join(`src="${b64}"`);
                    }

                    contentHtml = tempHtml;
                    imageSuccessCount = processed.images.length;
                    imageFailureCount = processed.failCount;
                    processed.failures.forEach((failure) => {
                        recordBrowserDiagnosticFailure(
                            {
                                scope: "image",
                                stage: failure.stage,
                                code: failure.code,
                                message: failure.message,
                                imageFailureCount: failure.count,
                                chapter: { index: 0, title, url: location.href }
                            },
                            diagnosticTaskId
                        );
                    });
                    log(t("single.log.imagesEmbedded", { count: processed.images.length }));
                } catch (imgErr: any) {
                    imageFailureCount = (contentHtml.match(/<img\s/gi) || []).length;
                    console.error(imgErr);
                    if (imageFailureCount > 0) {
                        recordBrowserDiagnosticFailure(
                            {
                                scope: "image",
                                stage: "processing",
                                code: "image-processing-failed",
                                message: "image-processing-failed",
                                imageFailureCount,
                                chapter: { index: 0, title, url: location.href }
                            },
                            diagnosticTaskId
                        );
                    }
                    log(t("single.log.imagesFailed"));
                }
            }

            const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").trim();
            let blob: Blob;
            let downloadFilename = "";

            // 构建下载内容
            if (format === "txt") {
                const finalTxt = `${metaHeader}${title}\n${author}\n本章URL: ${location.href}\n\n${contentText}`;
                blob = new Blob([finalTxt], { type: "text/plain;charset=utf-8" });
                downloadFilename = `${bookNamePrefix}${safeTitle}.txt`;
            } else {
                // 构建 HTML
                const mappingExport = prepareChapterMappingExport({ ...normalized.chapter, content: contentHtml }, 0);
                let mappingFontStyle = "";
                if (mappingExport) {
                    const fontDataUrl = await blobToBase64(mappingExport.font.blob);
                    mappingFontStyle = `@font-face { font-family: '${mappingExport.fontFamily}'; src: url('${fontDataUrl}') format('woff2'); font-display: swap; }`;
                    contentHtml = mappingExport.contentHtml;
                }
                const style = `
                <style>
                    ${mappingFontStyle}
                    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; background: #f9f9f9; }
                    .chapter-card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                    h1 { color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px; }
                    .meta { color: #666; font-size: 0.9em; margin-bottom: 20px; white-space: pre-wrap; background: #f0f0f0; padding: 10px; border-radius: 4px; }
                    .content { font-size: 1.1em; }
                    img { max-width: 100%; height: auto; display: block; margin: 10px auto; }
                </style>
            `;

                const metaBlock = htmlMeta.intro ? `<div class="meta">${htmlMeta.intro}</div>` : "";
                const finalHtml = `
                <!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${title}</title>
                    ${style}
                </head>
                <body>
                    <div class="chapter-card">
                        <h1>${title}</h1>
                        <p>${author}</p>
                        <p>本章URL: <a href="${location.href}">${location.href}</a></p>
                        ${metaBlock}
                        <hr/>
                        <div class="content">
                            ${contentHtml}
                        </div>
                    </div>
                </body>
                </html>
            `;
                blob = new Blob([finalHtml], { type: "text/html;charset=utf-8" });
                downloadFilename = `${bookNamePrefix}${safeTitle}.html`;
            }
            generated = true;

            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = downloadFilename;

            document.body.appendChild(a);
            a.click();
            downloadTriggered = true;
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

            await addDownloadHistory({
                ...(bookId === "unknown" ? {} : { bookId }),
                bookName: htmlMeta.bookName || parsed.bookName || "未命名小说",
                author: htmlMeta.author || author,
                format,
                sourcePageType: "single",
                chapterSummary: { totalCount: 1, missingCount: 0 },
                ...(format === "html"
                    ? {
                          imageInfo: {
                              enabled: imageEnabled,
                              successCount: imageSuccessCount,
                              failureCount: imageFailureCount
                          }
                      }
                    : {}),
                pageUrl: location.href
            });

            log(t("single.log.completed", { format: format.toUpperCase() }));
            diagnosticResult = "success";
        }
    } catch (e: any) {
        console.error(e);
        recordBrowserDiagnosticFailure(
            {
                scope: "export",
                stage: `single-${format}`,
                code: e?.name || "single-export-failed",
                message: e?.message || String(e),
                chapter: {
                    index: 0,
                    title: document.title.split(" - ")[0] || "未命名章节",
                    url: location.href
                }
            },
            diagnosticTaskId
        );
        showMessagePopup({
            tone: "error",
            title: t("single.downloadFailed.title"),
            message: t("single.downloadFailed.message"),
            details: e?.message || String(e)
        });
    } finally {
        // 下载触发后历史写入失败不影响导出成功
        const exportOutcome = downloadTriggered ? "success" : diagnosticResult;
        recordBrowserDiagnosticExport(
            {
                scope: "single",
                format,
                outcome: exportOutcome,
                generated,
                downloadTriggered,
                failureStage: exportOutcome === "failed" ? (generated ? "download" : "generate") : null
            },
            diagnosticTaskId
        );
        finishBrowserSingleChapterDiagnosticSession(diagnosticTaskId, diagnosticResult);
    }
}
