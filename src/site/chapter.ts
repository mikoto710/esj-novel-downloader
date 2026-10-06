import type { Chapter } from "../content/model";
import type { ChapterFetcherPort, DownloadTask } from "../download/contracts";
import { normalizeChapterMappingFont } from "../content/mapping-font";
import { fetchWithTimeout } from "../browser/request";
import { processHtmlImages, type ImageProcessingFailure } from "./images";
import { RequestGate } from "./request-gate";

/**
 * 解析单个章节页面的 HTML，提取标题、作者和正文
 */
export function parseChapterHtml(html: string, defaultTitle: string) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const h2 = (doc.querySelector("h2") as HTMLElement)?.innerText || defaultTitle;

    const bookName = document.title.split(" - ")[0].trim();

    const author = (doc.querySelector(".single-post-meta div") as HTMLElement)?.innerText.trim() || "";

    const contentEl = doc.querySelector(".forum-content") as HTMLElement;

    // 获取用于 EPUB 的 HTML (包含 img 标签)
    const contentHtml = contentEl ? contentEl.innerHTML : "";

    // 获取用于 TXT 的纯文本
    let contentText = contentEl ? contentEl.innerText : "";

    // 检测并移除正文开头重复的标题
    if (contentEl) {
        const safeTitle = h2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const titleRegex = new RegExp(`^\\s*${safeTitle}\\s*`, "i");
        contentText = contentText.replace(titleRegex, "").trim();
    }

    return {
        title: h2,
        author,
        contentHtml,
        contentText,
        bookName
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
            const processed = await processHtmlImages(finalHtml, chapterIndex, signal);
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
 * 普通章节请求与授权使用本任务同一个 gate，授权开始前等待普通请求完成
 */
export function createChapterFetcher(requestGate: RequestGate): ChapterFetcherPort {
    return {
        fetch(task: DownloadTask, signal?: AbortSignal) {
            return requestGate.runShared(async () => {
                const response = await fetchWithTimeout(task.url, { credentials: "include" }, 15000, signal);
                return response.text();
            }, signal);
        }
    };
}

/**
 * 移除 HTML 字符串中的所有 img 标签
 */
function removeImgTags(html: string): string {
    return html.replace(/<img[^>]*>/gi, "");
}
