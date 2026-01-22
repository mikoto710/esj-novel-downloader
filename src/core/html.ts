// src/core/html.ts

import { Chapter, BookMetadata } from "../types";
import { blobToBase64, log } from "../utils/index";

/**
 * 构建单文件 HTML
 */
export async function buildHtml(chapters: Chapter[], metadata: BookMetadata): Promise<Blob> {
    log("正在构建 HTML 文件...");

    const imgMap = new Map<string, string>();

    // 处理封面
    if (metadata.coverBlob) {
        const b64 = await blobToBase64(metadata.coverBlob);
        imgMap.set("cover", b64);
    }

    // 处理章节图片
    for (const chap of chapters) {
        if (chap.images && chap.images.length > 0) {
            for (const img of chap.images) {
                const b64 = await blobToBase64(img.blob);
                imgMap.set(img.id, b64);
            }
        }
    }

    // 简单的阅读样式
    const style = `
        <style>
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
            .toc { background: #fff; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .toc ul { list-style-type: none; padding: 0; margin: 0; }
            .toc li { margin: 5px 0; border-bottom: 1px dashed #eee; }
            .toc a { text-decoration: none; color: #0366d6; display: block; padding: 5px 0; }
            .toc a:hover { text-decoration: underline; background-color: #f0f8ff; }
            
            .cover-img { text-align: center; margin-bottom: 20px; }
            .meta-info { font-size: 0.9em; color: #666; margin-bottom: 20px; white-space: pre-wrap; }
        </style>
    `;

    // 目录
    let tocHtml = `<div class="toc"><h2>目录</h2><ul>`;
    chapters.forEach((chap, i) => {
        tocHtml += `<li><a href="#chap${i}">${chap.title}</a></li>`;
    });
    tocHtml += `</ul></div>`;

    // 封面和元数据
    let metaHtml = "";
    metaHtml += `<h1>${metadata.title}</h1>`;
    metaHtml += `<div class="meta-info">${metadata.author ? "作者: " + metadata.author : ""}</div>`;
    if (imgMap.has("cover")) {
        metaHtml += `<div class="cover-img"><img src="${imgMap.get("cover")}" alt="Cover" /></div>`;
    }

    // 章节内容封装
    let contentHtml = "";
    for (let i = 0; i < chapters.length; i++) {
        const chap = chapters[i];
        let body = chap.content;

        if (chap.images && chap.images.length > 0) {
            chap.images.forEach((img) => {
                const base64 = imgMap.get(img.id);
                if (base64) {
                    // 全局替换该图片引用
                    body = body.split(`src="${img.id}"`).join(`src="${base64}"`);
                }
            });
        }

        contentHtml += `
            <div id="chap${i}" class="chapter">
                <h2>${chap.title}</h2>
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
            <title>${metadata.title}</title>
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
