import { fetchWithTimeout, log, sleepWithAbort } from './index';

/**
 * 根据 MIME 类型获取文件后缀
 */
function getExtensionFromMime(mime: string): string {
    switch (mime.toLowerCase()) {
        case 'image/png': return 'png';
        case 'image/gif': return 'gif';
        case 'image/webp': return 'webp';
        case 'image/bmp': return 'bmp';
        case 'image/jpeg':
        case 'image/jpg':
        default: return 'jpg';
    }
}

/**
 * 压缩图片 (使用 Canvas)
 * @param blob 原始图片 Blob
 * @param quality 压缩质量 (0.1 - 1.0)
 * @param maxWidth 最大宽度 (防止过大)
 */
async function compressImage(blob: Blob, quality = 0.7, maxWidth = 800): Promise<Blob> {
    return new Promise((resolve, reject) => {
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

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            // 降级返回原图
            if (!ctx) return resolve(blob);

            // 填充白色背景 (防止透明 PNG 变黑)
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);

            ctx.drawImage(img, 0, 0, width, height);

            // 导出为 JPEG 进行压缩
            canvas.toBlob((b) => {
                if (b) resolve(b);
                else resolve(blob);
            }, 'image/jpeg', quality);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(blob);
        };

        img.src = url;
    });
}

/**
 * 处理 HTML 字符串，提取并下载所有图片
 * @param htmlContent 章节 HTML
 * @param chapterIndex 章节索引 (用于生成唯一 ID)
 * @param signal 中断信号
 */
export async function processHtmlImages(
    htmlContent: string,
    chapterIndex: number,
    signal?: AbortSignal
): Promise<{
    processedHtml: string;
    images: import('../types').ChapterImage[],
    failCount: number
}> {

    const div = document.createElement('div');
    div.innerHTML = htmlContent;

    const imgs = Array.from(div.querySelectorAll('img'));
    const images: import('../types').ChapterImage[] = [];
    let failCount = 0;

    if (imgs.length > 0) {
        console.log(`序列 ${chapterIndex + 1}: 发现 ${imgs.length} 张图片，开始处理...`);
    }

    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        let src = img.getAttribute('src');
        if (!src) continue;

        let downloadSuccess = false;

        let errorMsg = "未知错误";

        // URL 预处理
        try {
            if (src.startsWith('/')) {
                src = location.origin + src;
                img.setAttribute('src', src);
            } else if (!src.startsWith('http')) {
                src = new URL(src, location.href).href;
                img.setAttribute('src', src);
            }
        } catch (e: any) {
            console.warn(`非法 URL: ${src}`, e);
            errorMsg = "URL 格式错误";
        }

        if (src.startsWith('http')) {
            const MAX_RETRIES = 3;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                // 每次重试前检查取消信号
                if (signal?.aborted) break;

                try {
                    const response = await fetchWithTimeout(src!, {
                        method: 'GET',
                        referrerPolicy: 'no-referrer',
                        credentials: 'omit'
                    }, 1000, signal);

                    let blob = await response.blob();
                    let mimeType = blob.type;
                    let extension = getExtensionFromMime(mimeType);

                    // 压缩处理
                    if (blob.size > 100 * 1024) {
                        const compressedBlob = await compressImage(blob);
                        if (compressedBlob !== blob) {
                            blob = compressedBlob;
                            mimeType = 'image/jpeg';
                            extension = 'jpg';
                        }
                    }

                    const imageFilename = `img_${chapterIndex}_${i}.${extension}`;

                    images.push({
                        id: imageFilename,
                        blob: blob,
                        mediaType: mimeType
                    });

                    // 成功修改 DOM
                    img.removeAttribute('src');
                    img.setAttribute('data-epub-src', imageFilename);
                    img.removeAttribute('srcset');
                    img.removeAttribute('loading');
                    img.style.maxWidth = '100%';

                    downloadSuccess = true;
                    break;

                } catch (e: any) {
                    // 如果是用户手动取消，直接中断重试，也不记录失败
                    if (e.message === 'User Aborted' || signal?.aborted) {
                        break;
                    }
                    errorMsg = e.message;
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

            log(`❌ [插图获取失败] 序列${chapterIndex + 1}: ${src} \n失败原因： ${errorMsg}`);
            // 失败后保留远程链接
            img.removeAttribute('srcset');
            img.removeAttribute('loading');
            img.style.maxWidth = '100%';

            const originalAlt = img.getAttribute('alt') || '';
            img.setAttribute('alt', `${originalAlt} (图片加载失败)`);
        }

    }

    // 还原 HTML，替换 data-epub-src 为 src
    let finalHtml = div.innerHTML;
    finalHtml = finalHtml.replace(/data-epub-src="/g, 'src="');

    return {
        processedHtml: finalHtml,
        images,
        failCount
    };
}