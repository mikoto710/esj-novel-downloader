import { buildCurrentChapterHtml, embedChapterImages } from "../export/html";
import { buildCurrentChapterTxt } from "../export/txt";
import { createCurrentChapterFilename } from "../export/filename";
import { parseChapterHtml, normalizeParsedChapter } from "../site/chapter";
import { parseBookMetadata } from "../site/book";
import { getImageDownloadSetting } from "../storage/settings";
import { processHtmlImages } from "../site/images";
import { addDownloadHistory } from "../storage/history";
import { MappingFontError } from "../content/mapping-font";
import { confirmMappingFontExport } from "../ui/popups";
import { showMessagePopup } from "../ui/dialogs/message";
import { t } from "../ui/locale";
import { isProtectedChapterHtml } from "../site/protected-chapter";
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

        let txtIntro: string | undefined;
        let filenameBookName: string | undefined;
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

                txtIntro = meta.introTxt;
                filenameBookName = meta.bookName;

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
            normalized = await normalizeParsedChapter(parsed);
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

                    contentHtml = await embedChapterImages(processed.processedHtml, processed.images);
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

            let blob: Blob;
            const downloadFilename = createCurrentChapterFilename(filenameBookName, title, format);

            // 图片准备仍先于两种格式生成，TXT 不跳过原有资源工作
            if (format === "txt") {
                blob = buildCurrentChapterTxt({ intro: txtIntro, title, author, pageUrl: location.href, contentText });
            } else {
                blob = await buildCurrentChapterHtml(
                    { ...normalized.chapter, content: contentHtml },
                    { title, author, intro: htmlMeta.intro, pageUrl: location.href }
                );
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
