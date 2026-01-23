import { log } from "../utils/index";
import { parseChapterHtml, parseBookMetadata } from "../core/parser";

/**
 * 抓取并下载当前单章节页面
 */
export async function downloadCurrentPage(format: "txt" | "html" = "txt"): Promise<void> {
    try {
        log(`开始抓取当前单章 (${format.toUpperCase()})...`);

        const viewAllBtn = document.querySelector(".entry-navigation .view-all") as HTMLAnchorElement;
        let metaHeader = "";
        let bookNamePrefix = "";
        const htmlMeta = { intro: "", bookName: "" };

        if (viewAllBtn && viewAllBtn.href) {
            try {
                log("正在获取书籍信息...");
                const resp = await fetch(viewAllBtn.href);
                const html = await resp.text();
                const doc = new DOMParser().parseFromString(html, "text/html");

                const meta = parseBookMetadata(doc, viewAllBtn.href);

                metaHeader = meta.introTxt + "====================================\n\n";
                bookNamePrefix = `[${meta.bookName}] `;

                htmlMeta.intro = meta.introTxt;
                htmlMeta.bookName = meta.bookName;
            } catch (e) {
                console.warn("书籍元数据获取失败，仅下载正文");
            }
        }

        const html = document.documentElement.outerHTML;
        const defaultTitle = document.title.split(" - ")[0] || "未命名章节";

        const { title, author, contentText, contentHtml } = parseChapterHtml(html, defaultTitle);

        // 根据格式检查内容
        if ((format === "txt" && !contentText) || (format === "html" && !contentHtml)) {
            alert("未找到正文内容");
            return;
        }

        const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").trim();
        let blob: Blob;
        let downloadFilename = "";

        // 构建下载内容
        // TODO: 增加对图片的支持
        if (format === "txt") {
            const finalTxt = `${metaHeader}${title}\n${author}\n本章URL: ${location.href}\n\n${contentText}`;
            blob = new Blob([finalTxt], { type: "text/plain;charset=utf-8" });
            downloadFilename = `${bookNamePrefix}${safeTitle}.txt`;
        } else {
            // 构建 HTML
            const style = `
                <style>
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
                        <p>作者: ${author}</p>
                        <p>URL: <a href="${location.href}">${location.href}</a></p>
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

        log(`✔ 单章下载完成 (${format.toUpperCase()})`);
    } catch (e: any) {
        console.error(e);
        alert("下载出错: " + e.message);
    }
}
