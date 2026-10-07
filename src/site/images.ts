import { sleepWithAbort } from "../browser/timing";
import { fetchWithTimeout } from "../browser/request";
import { normalizeImageBlob } from "../content/image-format";
import type { BookCover, ChapterImage } from "../content/model";

const IMAGE_FETCH_TIMEOUT = 20_000;

export type ImageFailureStage = "url" | "request" | "format" | "processing";

/**
 * 供调用方关联任务的插图故障摘要，count 表示同类故障数量
 */
export interface ImageProcessingFailure {
    stage: ImageFailureStage;
    code: string;
    message: string;
    count: number;
}

function recordImageFailure(
    failures: ImageProcessingFailure[],
    stage: ImageFailureStage,
    code: string,
    message: string
): void {
    const existing = failures.find(
        (failure) => failure.stage === stage && failure.code === code && failure.message === message
    );
    if (existing) {
        existing.count++;
        return;
    }
    failures.push({ stage, code, message, count: 1 });
}

// 按尺寸与质量尝试压缩图片，返回 null 时由调用方保留原图
async function compressImage(blob: Blob, quality = 0.7, maxWidth = 800): Promise<Blob | null> {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url);
            let width = img.width;
            let height = img.height;

            // 缩放尺寸
            if (width > maxWidth) {
                height = (maxWidth / width) * height;
                width = maxWidth;
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");
            // Canvas 不可用时由调用方保留已规范化的原图
            if (!ctx) {
                return resolve(null);
            }

            // 填充白色背景避免透明 PNG 变黑
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, width, height);

            ctx.drawImage(img, 0, 0, width, height);

            // 导出为 JPEG 进行压缩
            canvas.toBlob(
                (b) => {
                    if (b) {
                        resolve(b);
                    } else {
                        resolve(null);
                    }
                },
                "image/jpeg",
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };

        img.src = url;
    });
}

/**
 * 按当前页面地址采集章节插图，返回替换正文及图片故障信息
 */
export async function processHtmlImages(
    htmlContent: string,
    chapterIndex: number,
    signal?: AbortSignal
): Promise<{
    processedHtml: string;
    images: ChapterImage[];
    failCount: number;
    failures: ImageProcessingFailure[];
}> {
    const div = document.createElement("div");
    div.innerHTML = htmlContent;

    const imgs = Array.from(div.querySelectorAll("img"));
    const images: ChapterImage[] = [];
    let failCount = 0;
    const failures: ImageProcessingFailure[] = [];

    if (imgs.length > 0) {
        console.log(`序列 ${chapterIndex + 1}: 发现 ${imgs.length} 张图片，开始处理...`);
    }

    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        let src = img.getAttribute("src");
        if (!src) {
            continue;
        }

        let downloadSuccess = false;

        let failureStage: ImageFailureStage = "url";
        let failureCode = "invalid-image-url";

        // URL 预处理
        // 相对图片沿用发起页面的地址基准，批量采集也不改用目标章节 URL
        const resolvedSrc = resolveImageUrl(src, location.href);
        if (resolvedSrc) {
            src = resolvedSrc;
            img.setAttribute("src", src);
        } else {
            console.warn(`非法 URL: ${src}`);
        }

        if (resolvedSrc) {
            failureStage = "request";
            failureCode = "image-request-failed";
            const MAX_RETRIES = 3;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                // 每次重试前检查取消信号
                if (signal?.aborted) {
                    break;
                }

                try {
                    const response = await fetchWithTimeout(
                        src!,
                        {
                            method: "GET",
                            referrerPolicy: "no-referrer",
                            credentials: "omit"
                        },
                        IMAGE_FETCH_TIMEOUT,
                        signal
                    );

                    const downloadedBlob = await response.blob();
                    const normalized = await normalizeImageBlob(downloadedBlob);
                    if (!normalized) {
                        failureStage = "format";
                        failureCode = "image-format-unrecognized";
                        throw new Error(`image-format-unrecognized:${downloadedBlob.type || "unknown"}`);
                    }

                    let { blob, mediaType: mimeType, extension } = normalized;

                    // 压缩处理
                    if (blob.size > 100 * 1024) {
                        failureStage = "processing";
                        failureCode = "image-processing-failed";
                        const compressedBlob = await compressImage(blob);
                        if (compressedBlob) {
                            blob = compressedBlob;
                            mimeType = "image/jpeg";
                            extension = "jpg";
                        }
                    }

                    const imageFilename = `img_${chapterIndex}_${i}.${extension}`;

                    images.push({
                        id: imageFilename,
                        blob,
                        mediaType: mimeType
                    });

                    // 成功修改 DOM
                    img.removeAttribute("src");
                    img.setAttribute("data-epub-src", imageFilename);
                    img.removeAttribute("srcset");
                    img.removeAttribute("loading");
                    img.style.maxWidth = "100%";

                    downloadSuccess = true;
                    break;
                } catch (e: any) {
                    // 如果是用户手动取消，直接中断重试，也不记录失败
                    if (e.message === "User Aborted" || signal?.aborted) {
                        break;
                    }
                    // 如果还没到最后一次，等待后重试
                    if (attempt < MAX_RETRIES) {
                        console.warn(`⚠️ 图片下载波动，重试 (${attempt}/${MAX_RETRIES}): ${src}`);
                        await sleepWithAbort(1500, signal);
                    }
                }
            }
        }

        if (!downloadSuccess && !signal?.aborted) {
            failCount++;
            recordImageFailure(failures, failureStage, failureCode, failureCode);

            // 失败后保留远程链接
            img.removeAttribute("srcset");
            img.removeAttribute("loading");
            img.style.maxWidth = "100%";

            const originalAlt = img.getAttribute("alt") || "";
            img.setAttribute("alt", `${originalAlt} (图片加载失败)`);
        }
    }

    // 还原 HTML，替换 data-epub-src 为 src
    let finalHtml = div.innerHTML;
    finalHtml = finalHtml.replace(/data-epub-src="/g, 'src="');

    return {
        processedHtml: finalHtml,
        images,
        failCount,
        failures
    };
}

/**
 * 按调用方提供的 baseUrl 解析 HTTP 图片地址，非法地址返回 null
 */
export function resolveImageUrl(src: string, baseUrl: string): string | null {
    try {
        const url = new URL(src, baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

export type CoverAcquisitionFact =
    | { code: "started" | "too-small" | "invalid-format" | "completed" }
    | { code: "skipped"; error: unknown };

/**
 * 封面是可选资源，获取异常降级为无封面并向调用者报告结构化事实
 */
export async function fetchBookCover(
    url: string,
    report: (fact: CoverAcquisitionFact) => void,
    signal?: AbortSignal
): Promise<BookCover | null> {
    try {
        report({ code: "started" });
        const response = await fetchWithTimeout(
            url,
            { method: "GET", referrerPolicy: "no-referrer", credentials: "omit" },
            15000,
            signal
        );
        const blob = await response.blob();
        if (blob.size < 1000) {
            report({ code: "too-small" });
            return null;
        }
        const normalized = await normalizeImageBlob(blob);
        if (!normalized || (normalized.extension !== "jpg" && normalized.extension !== "png")) {
            report({ code: "invalid-format" });
            return null;
        }
        report({ code: "completed" });
        return {
            blob: normalized.blob,
            ext: normalized.extension,
            mediaType: normalized.extension === "png" ? "image/png" : "image/jpeg"
        };
    } catch (error) {
        report({ code: "skipped", error });
        return null;
    }
}
