import { log, blobToBase64 } from "../utils/index";
import { parseChapterHtml, parseBookMetadata } from "../core/parser";
import { getImageDownloadSetting } from "../core/config";
import { processHtmlImages } from "../utils/image";
import { addDownloadHistory } from "../core/download-history";
import { MappingFontError, normalizeChapterMappingFont, prepareChapterMappingExport } from "../core/mapping-font";
import { confirmMappingFontExport } from "../ui/popups";
import { showMessagePopup } from "../ui/message-popup";

/**
 * 抓取并下载当前单章节页面
 */
export async function downloadCurrentPage(format: "txt" | "html" = "txt"): Promise<void> {
    try {
        log(`开始抓取当前单章 (${format.toUpperCase()})...`);

        const viewAllBtn = document.querySelector(".entry-navigation .view-all") as HTMLAnchorElement;
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

                metaHeader = meta.introTxt + "====================================\n\n";
                bookNamePrefix = `[${meta.bookName}] `;

                htmlMeta.intro = meta.baseIntroTxt;
                htmlMeta.bookName = meta.bookName;
                htmlMeta.author = meta.author;
            } catch (e) {
                console.warn("书籍元数据获取失败，仅下载正文");
            }
        }

        const html = document.documentElement.outerHTML;
        const defaultTitle = document.title.split(" - ")[0] || "未命名章节";

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
                    log(`已嵌入 ${processed.images.length} 张图片`);
                } catch (imgErr: any) {
                    imageFailureCount = (contentHtml.match(/<img\s/gi) || []).length;
                    console.error(imgErr);
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

            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = downloadFilename;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

            const bookId = viewAllBtn?.href.match(/\/detail\/(\d+)/)?.[1];
            await addDownloadHistory({
                bookId,
                bookName: htmlMeta.bookName || parsed.bookName || "未命名小说",
                author: htmlMeta.author || author,
                format,
                sourcePageType: "single",
                chapterInfo: title,
                imageInfo:
                    format === "html"
                        ? {
                              enabled: imageEnabled,
                              successCount: imageSuccessCount,
                              failureCount: imageFailureCount
                          }
                        : undefined,
                pageUrl: location.href
            });

            log(`✔ 单章下载完成 (${format.toUpperCase()})`);
        }
    } catch (e: any) {
        console.error(e);
        showMessagePopup({
            tone: "error",
            title: "单章下载失败",
            message: "下载当前章节时发生错误。",
            details: e.message
        });
    }
}
