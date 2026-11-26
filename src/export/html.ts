import type { Chapter, BookMetadata } from "../content/model";
import { blobToBase64 } from "../browser/files";
import { prepareChapterMappingExport } from "../content/mapping-font";
import { createStaticChapterBody, getChapterExportImages, readingHref } from "./chapter-body";
import { escapeXml } from "./text";

/**
 * 构建含封面和目录的整书或自选 HTML
 */
export async function buildBookHtml(chapters: Chapter[], metadata: BookMetadata): Promise<Blob> {
    const mappingExports = chapters.map((chapter, index) => prepareChapterMappingExport(chapter, index));
    const mappingFontStyles: string[] = [];
    const coverUrl = metadata.coverBlob ? await blobToBase64(metadata.coverBlob) : "";
    const bookTitle = escapeXml(metadata.title);

    for (const mappingExport of mappingExports) {
        if (!mappingExport) {
            continue;
        }
        mappingFontStyles.push(await embedMappingFont(mappingExport));
    }

    // 简单的阅读样式
    const style = `
        <style>
            ${mappingFontStyles.join("\n")}
            html { scroll-behavior: smooth; }
            body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; background: #f9f9f9; }
            img { max-width: 100%; height: auto; display: block; margin: 10px auto; }
            h1, h2, h3 { color: #2c3e50; }
            
            /* 章节卡片样式 */
            .chapter { 
                margin-bottom: 50px; 
                background: #fff; 
                padding: 20px; 
                border-radius: 8px; 
                box-shadow: 0 2px 5px rgba(0,0,0,0.05); 
                page-break-after: always; /* 强制分页，有助于阅读器识别章节边界 */
            }
            
            /* 目录样式 */
            .toc { position: sticky; top: 12px; z-index: 1; background: #fff; padding: 14px 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
            .toc summary { color: #2c3e50; cursor: pointer; font-size: 1.2em; font-weight: bold; }
            .toc-list { list-style-type: none; max-height: min(60vh, 520px); overflow-y: auto; padding: 10px 0 0; margin: 0; }
            .toc li { margin: 5px 0; border-bottom: 1px dashed #eee; }
            .toc a { text-decoration: none; color: #0366d6; display: block; padding: 5px 0; }
            .toc a:hover { text-decoration: underline; background-color: #f0f8ff; }
            @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
            @media print { .toc { position: static; box-shadow: none; } .toc-list { max-height: none; } }
            
            .cover-img { text-align: center; margin-bottom: 20px; }
            .meta-info { font-size: 0.9em; color: #666; margin-bottom: 20px; white-space: pre-wrap; }
        </style>
    `;

    // 目录
    let tocHtml = `<nav class="toc" aria-label="章节导航"><details><summary>章节导航（${chapters.length}）</summary><ol class="toc-list">`;
    chapters.forEach((chap, i) => {
        tocHtml += `<li><a href="#chap${i}">${escapeXml(chap.title)}</a></li>`;
    });
    tocHtml += `</ol></details></nav>`;

    // 封面和元数据
    let metaHtml = "";
    metaHtml += `<h1>${bookTitle}</h1>`;
    metaHtml += `<div class="meta-info">${metadata.author ? "作者: " + escapeXml(metadata.author) : ""}</div>`;
    if (coverUrl) {
        metaHtml += `<div class="cover-img"><img src="${escapeXml(coverUrl)}" alt="Cover" /></div>`;
    }

    // 章节内容封装
    let contentHtml = "";
    for (let i = 0; i < chapters.length; i++) {
        const chap = chapters[i];
        const body = await renderHtmlBody(chap, mappingExports[i]?.contentHtml ?? chap.content, true);

        contentHtml += `
            <div id="chap${i}" class="chapter">
                <h2>${escapeXml(chap.title)}</h2>
                <div class="content">${body}</div>
            </div>
        `;
    }

    // 组装完整 HTML
    const fullHtml = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${bookTitle}</title>
            ${style}
        </head>
        <body>
            ${metaHtml}
            ${tocHtml}
            ${contentHtml}
        </body>
        </html>
    `;

    return new Blob([fullHtml], { type: "text/html;charset=utf-8" });
}

async function renderHtmlBody(chapter: Chapter, content: string, imageEnabled: boolean): Promise<string> {
    const embeddedImages = new Map<string, string>();
    if (imageEnabled) {
        for (const image of getChapterExportImages(chapter)) {
            embeddedImages.set(image.id, await blobToBase64(image.blob));
        }
    }
    return createStaticChapterBody(content, imageEnabled ? (src) => embeddedImages.get(src) ?? readingHref(src) : null)
        .innerHTML;
}

async function embedMappingFont(
    mappingExport: NonNullable<ReturnType<typeof prepareChapterMappingExport>>
): Promise<string> {
    const dataUrl = await blobToBase64(mappingExport.font.blob);
    return `@font-face { font-family: '${mappingExport.fontFamily}'; src: url('${dataUrl}') format('woff2'); font-display: swap; }`;
}

/**
 * 构建单章布局及配套的插图和字体资源
 */
export async function buildCurrentChapterHtml(
    chapter: Chapter,
    {
        title,
        author,
        intro,
        pageUrl,
        imageEnabled = true
    }: { title: string; author: string; intro: string; pageUrl: string; imageEnabled?: boolean }
): Promise<Blob> {
    const mappingExport = prepareChapterMappingExport(chapter, 0);
    const fontStyle = mappingExport ? await embedMappingFont(mappingExport) : "";
    const contentHtml = await renderHtmlBody(chapter, mappingExport?.contentHtml ?? chapter.content, imageEnabled);
    const safeTitle = escapeXml(title);
    const safePageUrl = escapeXml(pageUrl);
    const pageLink = readingHref(pageUrl) ? `<a href="${safePageUrl}">${safePageUrl}</a>` : safePageUrl;
    const style = `
                <style>
                    ${fontStyle}
                    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; background: #f9f9f9; }
                    .chapter-card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                    h1 { color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px; }
                    .meta { color: #666; font-size: 0.9em; margin-bottom: 20px; white-space: pre-wrap; background: #f0f0f0; padding: 10px; border-radius: 4px; }
                    .content { font-size: 1.1em; }
                    img { max-width: 100%; height: auto; display: block; margin: 10px auto; }
                </style>
            `;

    const metaBlock = intro ? `<div class="meta">${escapeXml(intro)}</div>` : "";
    const finalHtml = `
                <!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${safeTitle}</title>
                    ${style}
                </head>
                <body>
                    <div class="chapter-card">
                        <h1>${safeTitle}</h1>
                        <p>${escapeXml(author)}</p>
                        <p>本章URL: ${pageLink}</p>
                        ${metaBlock}
                        <hr/>
                        <div class="content">
                            ${contentHtml}
                        </div>
                    </div>
                </body>
                </html>
            `;
    return new Blob([finalHtml], { type: "text/html;charset=utf-8" });
}
