import type { DownloadTask } from "../download/contracts";

/**
 * 解析书籍详情页的 DOM，提取元数据
 */
export function parseBookMetadata(doc: Document, pageUrl: string) {
    let bookName = "未命名小说";
    const titleEl = doc.querySelector(".book-detail h2.text-normal");
    if (titleEl) {
        bookName = titleEl.textContent?.trim() || bookName;
    } else {
        bookName = doc.title.split(" - ")[0].trim();
    }

    const symbolMap: Record<string, string> = {
        "\\": "-",
        "/": "- ",
        ":": "：",
        "*": "☆",
        "?": "？",
        '"': " ",
        "<": "《",
        ">": "》",
        "|": "-",
        ".": "。",
        "\t": " ",
        "\n": " "
    };
    const safeBookName = bookName
        .split("")
        .map((c) => symbolMap[c] || c)
        .join("");

    let author = "未知作者";
    let infoBlock = "";

    const infoUl = doc.querySelector(".book-detail ul.book-detail");
    if (infoUl) {
        const listItems = Array.from(infoUl.querySelectorAll("li"));

        listItems.forEach((li) => {
            if (li.classList.contains("hidden-md-up") || li.querySelector(".rating-stars")) {
                return;
            }

            const text = (li as HTMLElement).innerText.replace(/[ \t]+/g, " ").trim();
            if (!text) {
                return;
            }

            if (text.includes("作者")) {
                const authorLink = li.querySelector("a");
                author = authorLink ? authorLink.innerText.trim() : text.replace(/作者[:：]/g, "").trim();
            }

            // 拼接到信息块
            infoBlock += text + "\n";
        });

        infoBlock += "\n";
    }

    // 标签
    const tags = Array.from(doc.querySelectorAll("section.widget-tags a.tag"))
        .map((tag) => tag.textContent?.trim() || "")
        .filter((tag, index, allTags) => tag.length > 0 && allTags.indexOf(tag) === index);

    // 封面
    const imgNode = doc.querySelector(".product-gallery img") as HTMLImageElement;
    let coverUrl: string | undefined = undefined;
    if (imgNode) {
        const rawSrc = imgNode.getAttribute("src");
        if (rawSrc) {
            coverUrl = rawSrc.startsWith("http") ? rawSrc : `${location.origin}${rawSrc}`;
        }
    }

    // 简介
    let descText = "";
    const descContainer = doc.querySelector("#details .description") || doc.querySelector(".description");

    if (descContainer) {
        const clone = descContainer.cloneNode(true) as HTMLElement;

        // 换行
        const brs = clone.querySelectorAll("br");
        brs.forEach((br) => {
            br.replaceWith("\n");
        });

        const paragraphs = Array.from(descContainer.querySelectorAll("p"));
        if (paragraphs.length > 0) {
            descText = paragraphs.map((p) => p.textContent?.trim()).join("\n");
        } else {
            descText = (descContainer as HTMLElement).innerText;
        }

        // 将3个及以上的连续换行压缩为2个
        descText = descText.replace(/(\n\s*){3,}/g, "\n\n").trim();
    }

    infoBlock = infoBlock.trim() + "\n";

    const baseIntro = `書名: ${bookName}\nURL: ${pageUrl}\n${infoBlock}\n${descText}\n\n`;
    const infoBlockWithTags = tags.length > 0 ? `${infoBlock.trim()}\n标签: ${tags.join(", ")}\n` : infoBlock;
    const fullIntro = `書名: ${bookName}\nURL: ${pageUrl}\n${infoBlockWithTags}\n${descText}\n\n`;

    return {
        bookName: safeBookName,
        rawBookName: bookName,
        author,
        coverUrl,
        introTxt: fullIntro,
        baseIntroTxt: baseIntro,
        description: descText,
        tags
    };
}

export interface PreparedBook {
    tasks: DownloadTask[];
    meta: ReturnType<typeof parseBookMetadata>;
    pageUrl: string;
}

export class BookPreflightError extends Error {
    constructor(
        readonly code: "chapter-list-missing" | "detail-fetch-failed",
        readonly stage: "chapter-list" | "book-metadata",
        options?: ErrorOptions
    ) {
        super(code, options);
        this.name = "BookPreflightError";
    }
}

/**
 * 从详情页地址读取书籍身份，保留无法识别时的原有结果
 */
export function getDetailBookId(pageUrl: string): string {
    const match = pageUrl.match(/\/detail\/(\d+)/);
    return match ? match[1] : "unknown";
}

/**
 * 从论坛路径末尾读取书籍身份
 */
export function getForumBookId(pathname: string): string {
    const urlParts = pathname.split("/").filter(Boolean);
    for (let index = urlParts.length - 1; index >= 0; index--) {
        if (/^\d+$/.test(urlParts[index])) {
            return urlParts[index];
        }
    }
    return "";
}

function readBookPlan(doc: Document, pageUrl: string, fetched: boolean): PreparedBook {
    const chapterLinks = Array.from(doc.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];
    if (chapterLinks.length === 0) {
        throw new BookPreflightError("chapter-list-missing", "chapter-list");
    }
    return {
        tasks: chapterLinks.map((node, index) => ({
            index,
            url: fetched ? new URL(node.getAttribute("href") || node.href, pageUrl).href : node.href,
            title: (node.getAttribute("data-title") || node.innerText || "").trim()
        })),
        meta: parseBookMetadata(doc, pageUrl),
        pageUrl
    };
}

/**
 * 直接解释详情页当前文档，保留浏览器解析的章节地址
 */
export function loadDetailBook(doc: Document, pageUrl: string): PreparedBook {
    return readBookPlan(doc, pageUrl, false);
}

/**
 * 论坛入口获取详情文档，按详情地址解释相对章节链接
 */
export async function loadForumBook(bookId: string, origin: string): Promise<PreparedBook> {
    const detailUrl = `${origin}/detail/${bookId}.html`;
    let response: Response;
    try {
        response = await fetch(detailUrl);
        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }
    } catch (error) {
        throw new BookPreflightError("detail-fetch-failed", "book-metadata", { cause: error });
    }
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    return readBookPlan(doc, detailUrl, true);
}
