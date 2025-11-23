/**
 * 解析单个章节页面的 HTML，提取标题、作者和正文
 * 适用于标准章节页和论坛帖子页
 */
export function parseChapterHtml(html: string, defaultTitle: string): { title: string, author: string, content: string, bookName: string } {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 尝试提取标题，如果没找到则使用列表里的标题
    const h2 = (doc.querySelector("h2") as HTMLElement)?.innerText || defaultTitle;
    
    // 提取书名
    const bookName = document.title.split(' - ')[0].trim();

    // 提取作者
    const author = (doc.querySelector(".single-post-meta div") as HTMLElement)?.innerText.trim() || "";
    
    // 提取正文
    const content = (doc.querySelector(".forum-content") as HTMLElement)?.innerText || "";

    return { title: h2, author, content, bookName };
}