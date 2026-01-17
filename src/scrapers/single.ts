import { log } from '../utils/index';
import { parseChapterHtml, parseBookMetadata } from '../core/parser';

/**
 * 抓取并下载当前单章节页面
 */
export async function downloadCurrentPage(): Promise<void> {
    try {
        log("开始抓取当前单章...");

        const viewAllBtn = document.querySelector('.entry-navigation .view-all') as HTMLAnchorElement;
        let metaHeader = "";
        let bookNamePrefix = "";

        if (viewAllBtn && viewAllBtn.href) {
            try {
                log("正在获取书籍信息...");
                const resp = await fetch(viewAllBtn.href);
                const html = await resp.text();
                const doc = new DOMParser().parseFromString(html, "text/html");
                
                const meta = parseBookMetadata(doc, viewAllBtn.href);
                
                metaHeader = meta.introTxt + 
                             "====================================\n\n";
                bookNamePrefix = `[${meta.bookName}] `;
            } catch (e) {
                console.warn("书籍元数据获取失败，仅下载正文");
            }
        }

        const html = document.documentElement.outerHTML;
        const defaultTitle = document.title.split(' - ')[0] || "未命名章节";
        
        const { title, author, contentText } = parseChapterHtml(html, defaultTitle);

        if (!contentText) {
            alert("未找到正文内容");
            return;
        }

        const finalTxt = `${metaHeader}${title}\n${author}\n本章URL: ${location.href}\n\n${contentText}`;

        const blob = new Blob([finalTxt], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").trim();
        a.download = `${bookNamePrefix}${safeTitle}.txt`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        log(`✔ 单章下载完成`);

    } catch (e: any) {
        console.error(e);
        alert("下载出错: " + e.message);
    }
}