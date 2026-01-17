/**
 * 解析书籍详情页的 DOM，提取元数据
 */
export function parseBookMetadata(doc: Document, pageUrl: string) {

    let bookName = "未命名小说";
    const titleEl = doc.querySelector(".book-detail h2.text-normal");
    if (titleEl) {
        bookName = titleEl.textContent?.trim() || bookName;
    } else {
        bookName = doc.title.split(' - ')[0].trim();
    }

    const symbolMap: Record<string, string> = { "\\": "-", "/": "- ", ":": "：", "*": "☆", "?": "？", "\"": " ", "<": "《", ">": "》", "|": "-", ".": "。", "\t": " ", "\n": " " };
    const safeBookName = bookName.split('').map(c => symbolMap[c] || c).join('');

    let author = "未知作者";
    let infoBlock = "";

    const infoUl = doc.querySelector(".book-detail ul.book-detail");
    if (infoUl) {
        const listItems = Array.from(infoUl.querySelectorAll('li'));

        listItems.forEach(li => {
            if (li.classList.contains('hidden-md-up') || li.querySelector('.rating-stars')) {
                return;
            }

            let text = (li as HTMLElement).innerText.replace(/[ \t]+/g, ' ').trim();
            if (!text) return;

            if (text.includes("作者")) {
                const authorLink = li.querySelector('a');
                author = authorLink ? authorLink.innerText.trim() : text.replace(/作者[:：]/g, "").trim();
            }

            // 拼接到信息块
            infoBlock += text + "\n";
        });

        infoBlock += "\n";
    }

    // 封面
    const imgNode = doc.querySelector(".product-gallery img") as HTMLImageElement;
    let coverUrl: string | undefined = undefined;
    if (imgNode) {
        const rawSrc = imgNode.getAttribute('src');
        if (rawSrc) {
            coverUrl = rawSrc.startsWith('http') ? rawSrc : `${location.origin}${rawSrc}`;
        }
    }

    // 简介
    let descText = "";
    const descContainer = doc.querySelector("#details .description");

    if (descContainer) {
        const clone = descContainer.cloneNode(true) as HTMLElement;

        // 换行
        const brs = clone.querySelectorAll('br');
        brs.forEach(br => {
            br.replaceWith('\n');
        });

        const paragraphs = Array.from(descContainer.querySelectorAll('p'));
        if (paragraphs.length > 0) {
            descText = paragraphs.map(p => p.textContent?.trim()).join("\n");
        } else {
            descText = (descContainer as HTMLElement).innerText;
        }

        // 将3个及以上的连续换行压缩为2个
        descText = descText.replace(/(\n\s*){3,}/g, '\n\n').trim();
    }

    infoBlock = infoBlock.trim() + "\n";

    const fullIntro = `書名: ${bookName}\nURL: ${pageUrl}\n${infoBlock}\n${descText}\n\n`;

    return {
        bookName: safeBookName,
        rawBookName: bookName,
        author,
        coverUrl,
        introTxt: fullIntro
    };
}

/**
 * 解析单个章节页面的 HTML，提取标题、作者和正文
 */
export function parseChapterHtml(html: string, defaultTitle: string) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const h2 = (doc.querySelector("h2") as HTMLElement)?.innerText || defaultTitle;

    const bookName = document.title.split(' - ')[0].trim();

    const author = (doc.querySelector(".single-post-meta div") as HTMLElement)?.innerText.trim() || "";

    let content = (doc.querySelector(".forum-content") as HTMLElement)?.innerText || "";

    // 检测并移除正文开头重复的标题
    const contentEl = doc.querySelector(".forum-content") as HTMLElement;

    // 获取用于 EPUB 的 HTML (包含 img 标签)
    let contentHtml = contentEl ? contentEl.innerHTML : "";

    // 获取用于 TXT 的纯文本
    let contentText = contentEl ? contentEl.innerText : "";

    if (contentEl) {
        const safeTitle = h2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const titleRegex = new RegExp(`^\\s*${safeTitle}\\s*`, 'i');

        contentText = contentText.replace(titleRegex, '').trim();
    }

    return {
        title: h2,
        author,
        contentHtml,
        contentText,
        bookName
    };
}