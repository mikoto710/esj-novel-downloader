import type { Chapter } from "../content/model";
import type { ChapterFetcherPort, ChapterPageFailureCode, DownloadTask } from "../download/contracts";
import { normalizeChapterMappingFont } from "../content/mapping-font";
import { isReadingElement } from "../content/reading-markup";
import { fetchPageText, fetchWithTimeout } from "../browser/request";
import { parseInertHtml } from "../browser/html";
import { processHtmlImages, type ImageProcessingFailure } from "./images";
import { RequestGate } from "./request-gate";
import { isCurrentSiteChapter } from "./routes";

const TEXT_BLOCKS = new Set(
    "ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DETAILS DIV DL DT FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION SUMMARY TABLE TD TH TR UL".split(
        " "
    )
);

function readChapterBody(body: HTMLElement, title: string): { text: string; hasBody: boolean } {
    const lines: string[] = [];
    let line = "";
    let hasImage = false;

    function endLine(explicit = false) {
        if (explicit || line.trim()) {
            lines.push(line.trim());
        }
        line = "";
    }

    function visit(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
            line += node.textContent?.replace(/[\t\n\f\r ]+/g, " ") || "";
        } else if (isReadingElement(node) && !node.hidden) {
            const tag = node.tagName;
            if (tag === "BR") {
                endLine(true);
                return;
            }
            if (tag === "IMG") {
                hasImage ||= Boolean(node.getAttribute("src")?.trim());
                return;
            }
            const block = TEXT_BLOCKS.has(tag);
            if (block) {
                endLine();
            }
            node.childNodes.forEach(visit);
            if (block) {
                endLine();
            }
        }
    }

    body.childNodes.forEach(visit);
    endLine();
    const first = lines.findIndex(Boolean);
    if (first >= 0 && lines[first] === title) {
        lines.splice(first, 1);
    }
    return { text: lines.join("\n").trim(), hasBody: first >= 0 || hasImage };
}

/**
 * 解析章节标题、作者与正文，按章节页地址还原阅读链接
 */
export function parseChapterHtml(html: string, defaultTitle: string, sourceUrl = location.href) {
    const doc = parseInertHtml(html).content;

    const h2 = doc.querySelector("h2")?.textContent?.trim() || defaultTitle;

    const bookName = document.title.split(" - ")[0].trim();

    const author = doc.querySelector(".single-post-meta div")?.textContent?.trim() || "";

    const contentEl = doc.querySelector<HTMLElement>(".forum-content");
    const body = contentEl ? readChapterBody(contentEl, h2) : null;
    let pageFailure: ChapterPageFailureCode | undefined;
    if (!contentEl) {
        const loginForm = doc.querySelector("form.login-box");
        pageFailure =
            loginForm?.querySelector('input[type="email"][name="email"]') &&
            loginForm.querySelector('input[type="password"][name="pwd"]')
                ? "chapter-login-page"
                : "chapter-content-missing";
    } else if (!body?.hasBody) {
        pageFailure = "chapter-content-missing";
    }

    contentEl?.querySelectorAll("a[href]").forEach((link) => {
        const href = link.getAttribute("href")?.trim();
        if (!href || href.startsWith("#")) {
            return;
        }
        try {
            const url = new URL(href, sourceUrl);
            if (url.protocol === "http:" || url.protocol === "https:") {
                link.setAttribute("href", url.href);
            }
        } catch {
            // 无法解析的地址由导出时的链接校验移除
        }
    });
    const contentHtml = contentEl ? contentEl.innerHTML : "";

    return {
        title: h2,
        author,
        contentHtml,
        contentText: body?.text || "",
        bookName,
        sourceUrl,
        ...(pageFailure ? { pageFailure } : {})
    };
}

/**
 * 将站点解析结果绑定为正文、TXT 和映射字体的一份规范化内容
 */
export function normalizeParsedChapter(result: ReturnType<typeof parseChapterHtml>, signal?: AbortSignal) {
    return normalizeChapterMappingFont(
        {
            title: result.title,
            content: result.contentHtml,
            txtSegment: `${result.title}\n\n${result.author}\n\n${result.contentText}\n\n`
        },
        signal
    );
}

/**
 * 正文与插图采集故障，任务和诊断归属由调用方附加
 */
export interface ProcessedSourceChapter {
    chapter: Chapter;
    imageFailures: ImageProcessingFailure[];
    imageProcessingError?: unknown;
}

/**
 * 先规范化字体再处理插图，返回正文及由调用者绑定任务归属的采集事实
 */
export async function processParsedChapter(
    result: ReturnType<typeof parseChapterHtml>,
    chapterIndex: number,
    imageEnabled: boolean,
    signal?: AbortSignal
): Promise<ProcessedSourceChapter> {
    const normalized = await normalizeParsedChapter(result, signal);
    let finalHtml = normalized.chapter.content;
    let images: Chapter["images"] = [];
    let imageErrors = 0;
    let imageFailures: ImageProcessingFailure[] = [];
    let imageProcessingError: unknown;
    let processingFailed = false;

    if (imageEnabled) {
        try {
            const processed = await processHtmlImages(finalHtml, chapterIndex, result.sourceUrl, signal);
            finalHtml = processed.processedHtml;
            images = processed.images;
            imageErrors = processed.failCount;
            imageFailures = processed.failures;
        } catch (error) {
            imageErrors = (finalHtml.match(/<img\s/gi) || []).length;
            imageProcessingError = error;
            processingFailed = true;
            if (imageErrors > 0) {
                imageFailures = [
                    {
                        stage: "processing",
                        code: "image-processing-failed",
                        message: "image-processing-failed",
                        count: imageErrors
                    }
                ];
            }
        }
    } else {
        // 必须基于字体规范化后的正文去图，不能把已移除的页面 data CSS 再写回缓存
        finalHtml = removeImgTags(finalHtml);
    }

    return {
        chapter: { ...normalized.chapter, content: finalHtml, images, imageErrors },
        imageFailures,
        ...(processingFailed ? { imageProcessingError } : {})
    };
}

/**
 * 定位单章导航中指向书籍详情的原站链接
 */
export function findChapterBookLink(root: ParentNode): HTMLAnchorElement | null {
    return root.querySelector('.entry-navigation a.view-all[href]:not([href=""])');
}

/**
 * 普通章节请求与授权使用本任务同一个 gate，授权开始前等待普通请求完成
 */
export function createChapterFetcher(requestGate: RequestGate, useBrowserFetch: boolean): ChapterFetcherPort {
    const origin = location.origin;
    return {
        isSiteChapter: (task) => isCurrentSiteChapter(task.url, origin),
        fetch(task: DownloadTask, signal?: AbortSignal) {
            return requestGate.runShared(async () => {
                const url = task.url;
                if (!isCurrentSiteChapter(url, origin)) {
                    throw new Error("Invalid chapter target");
                }
                if (useBrowserFetch) {
                    return fetchPageText(url, {
                        credentials: "include",
                        mode: "same-origin",
                        signal: signal ?? null
                    });
                }
                const response = await fetchWithTimeout(url, { credentials: "include" }, 15000, signal);
                if (response.url && new URL(response.url).origin !== origin) {
                    throw new Error("Unexpected chapter response origin");
                }
                return response.text();
            }, signal);
        }
    };
}

// 移除 HTML 字符串中的所有 img 标签
function removeImgTags(html: string): string {
    if (!/<img\b/i.test(html)) {
        return html;
    }
    const template = parseInertHtml(html);
    template.content.querySelectorAll("img").forEach((img) => img.remove());
    return template.innerHTML;
}
