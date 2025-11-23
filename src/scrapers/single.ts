import { log } from '../utils/index';
import { parseChapterHtml } from '../core/parser';

/**
 * 抓取当前单章页面并导出为 TXT
 */
export function downloadCurrentPage(): void {
    try {
        // 获取 HTML
        const html = document.documentElement.outerHTML;
        const defaultTitle = document.title.split(' - ')[0] || "未命名章节";

        // 提取内容
        const { bookName, title, author, content } = parseChapterHtml(html, defaultTitle);

        if (!content) {
            alert("未找到正文内容");
            return;
        }

        // 组装 TXT
        const txtContent = `书名: ${bookName}\n标题: ${title}\n作者: ${author}\nURL: ${location.href}\n\n${content}`;

        // 生成 Blob 并下载
        const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        
        // 净化文件名
        const safeFilename = title.replace(/[\\/:*?"<>|]/g, "_").trim();
        a.download = `${safeFilename}.txt`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        log(`单章下载完成: ${safeFilename}`);
    } catch (e: any) {
        console.error(e);
        alert("下载出错: " + e.message);
    }
}