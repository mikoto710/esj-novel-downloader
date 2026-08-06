import { blobToBase64 } from "../utils/index";
import { parseChapterHtml, parseBookMetadata } from "../core/parser";
import { getImageDownloadSetting } from "../core/config";
import { processHtmlImages } from "../utils/image";
import { addDownloadHistory } from "../core/download-history";
import { MappingFontError, normalizeChapterMappingFont, prepareChapterMappingExport } from "../core/mapping-font";
import {
    closeProtectedChapterPrompt,
    confirmMappingFontExport,
    promptProtectedChapterPassword,
    setProtectedChapterPromptBusy
} from "../ui/popups";
import { showMessagePopup } from "../ui/message-popup";
import { createBrowserProtectedChapterAuth, isProtectedChapterHtml } from "../adapters/browser-protected-chapter";
import type { DownloadTask, ProtectedChapterDecision } from "../core/download/contracts";
import {
    browserDiagnosticLog as log,
    finishBrowserSingleChapterDiagnosticSession,
    recordBrowserDiagnosticExport,
    recordBrowserDiagnosticFailure,
    startBrowserDiagnosticSession,
    updateBrowserDiagnosticSessionMetadata
} from "../adapters/browser-diagnostics";

type ProtectedTerminalDecision = Extract<ProtectedChapterDecision, { action: "skip-current" | "skip-all" | "cancel" }>;

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

async function unlockSingleProtectedChapter(
    pageHtml: string,
    task: DownloadTask,
    diagnosticTaskId: string
): Promise<string | null> {
    if (!isProtectedChapterHtml(pageHtml)) {
        return pageHtml;
    }

    const auth = createBrowserProtectedChapterAuth();
    let message: string | undefined;
    let initialPassword: string | undefined;
    let rememberPassword = false;
    let retryConnection = false;

    while (true) {
        const requestController = new AbortController();
        let pendingDecision: ProtectedTerminalDecision | null = null;
        const decision = await promptProtectedChapterPassword(
            {
                task,
                totalChapters: 1,
                pendingCount: 1,
                rememberPassword,
                retryConnection,
                ...(initialPassword ? { initialPassword } : {}),
                ...(message ? { message } : {})
            },
            requestController.signal,
            (nextDecision) => {
                pendingDecision = nextDecision;
                requestController.abort();
            }
        );

        if (decision.action !== "submit") {
            requestController.abort();
            closeProtectedChapterPrompt();
            log(`⏭ 已取消单章密码导出：${task.title}`);
            return null;
        }

        rememberPassword = decision.rememberPassword;
        initialPassword = decision.rememberPassword ? decision.password : undefined;
        setProtectedChapterPromptBusy();

        let result;
        let technicalFailure = false;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                result = await auth.unlock(task, pageHtml, decision.password, requestController.signal);
                break;
            } catch (error) {
                if (pendingDecision || isAbortError(error)) {
                    break;
                }
                if (attempt === 0) {
                    log(`⚠️ 单章密码连接失败，正在进行一次技术重试：${task.title}`);
                    continue;
                }
                technicalFailure = true;
            }
        }

        if (pendingDecision) {
            closeProtectedChapterPrompt();
            log(`⏭ 已取消单章密码导出：${task.title}`);
            return null;
        }
        if (technicalFailure || !result) {
            recordBrowserDiagnosticFailure(
                {
                    scope: "chapter",
                    stage: "protected-auth",
                    code: "network-error",
                    message: "密码章节连接失败",
                    chapter: task
                },
                diagnosticTaskId
            );
            log(`❌ 单章密码连接失败：${task.title}`);
            message = "连接失败，请检查网络后重试。";
            retryConnection = true;
            continue;
        }
        if (result.kind === "password-rejected") {
            initialPassword = undefined;
            rememberPassword = false;
            retryConnection = false;
            message = result.message;
            log(`⚠️ 单章密码不正确：${task.title}`);
            continue;
        }
        if (result.kind === "protocol-error") {
            recordBrowserDiagnosticFailure(
                {
                    scope: "chapter",
                    stage: "protected-auth",
                    code: result.code,
                    message: result.message,
                    chapter: task
                },
                diagnosticTaskId
            );
            log(`❌ 单章密码授权响应异常：${task.title}`);
            message = result.message;
            retryConnection = true;
            continue;
        }

        closeProtectedChapterPrompt();
        log(`🔓 单章密码解锁完成：${task.title}`);
        return result.html;
    }
}

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
        // 单章导出不应覆盖全本任务留给后续导出失败使用的会话指针。
        { rememberForLaterFailures: false }
    );

    try {
        log(`开始抓取当前单章 (${format.toUpperCase()})...`);

        let metaHeader = "";
        let bookNamePrefix = "";
        const htmlMeta = { intro: "", bookName: "", author: "" };

        if (viewAllBtn && viewAllBtn.href) {
            try {
                log("正在获取书籍信息...");
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

        let html = document.documentElement.outerHTML;
        const defaultTitle = document.title.split(" - ")[0] || "未命名章节";
        const unlockedHtml = await unlockSingleProtectedChapter(
            html,
            { index: 0, url: location.href, title: defaultTitle },
            diagnosticTaskId
        );
        if (!unlockedHtml) {
            diagnosticResult = "cancelled";
            return;
        }
        html = unlockedHtml;

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
                    title: "映射字体解析失败",
                    message: "本章检测到映射字体，但无法完成解析，已阻止导出。",
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
                title: "TXT 导出不可用",
                message: "本章使用自定义映射字体，正文尚未恢复为真实 Unicode，无法导出正确 TXT。"
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
                    message: "当前页面没有可导出的正文内容",
                    chapter: { index: 0, title, url: location.href }
                },
                diagnosticTaskId
            );
            showMessagePopup({ tone: "warning", title: "未找到正文", message: "当前页面没有可导出的正文内容。" });
            return;
        } else {
            if (imageEnabled) {
                log("正在下载并处理插图...");
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
                    log(`已嵌入 ${processed.images.length} 张图片`);
                } catch (imgErr: any) {
                    imageFailureCount = (contentHtml.match(/<img\s/gi) || []).length;
                    console.error(imgErr);
                    if (imageFailureCount > 0) {
                        recordBrowserDiagnosticFailure(
                            {
                                scope: "image",
                                stage: "processing",
                                code: "image-processing-failed",
                                message: "图片处理异常，正文已保留",
                                imageFailureCount,
                                chapter: { index: 0, title, url: location.href }
                            },
                            diagnosticTaskId
                        );
                    }
                    log(`⚠️ 图片处理失败，将保留原链接`);
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
                chapterInfo: title,
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

            log(`✔ 单章下载完成 (${format.toUpperCase()})`);
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
            title: "单章下载失败",
            message: "下载当前章节时发生错误。",
            details: e?.message || String(e)
        });
    } finally {
        closeProtectedChapterPrompt();
        // 下载已触发后，即使后续历史写入失败，导出本身仍应记为成功；任务失败原因另行保留。
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
