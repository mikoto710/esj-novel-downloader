import { fetchWithTimeout, log } from './index';

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
        default: return 'jpg'; // 默认回退到 jpg
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
): Promise<{ processedHtml: string; images: import('../types').ChapterImage[] }> {
    
    const div = document.createElement('div');
    div.innerHTML = htmlContent;
    
    const imgs = Array.from(div.querySelectorAll('img'));
    const images: import('../types').ChapterImage[] = [];

    // log(`章节 ${chapterIndex}: 发现 ${imgs.length} 张图片`);
    console.log(`序列 ${chapterIndex}: 发现 ${imgs.length} 张图片，正在处理...`);

    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        let src = img.getAttribute('src');
        if (!src) continue;

        try {
            const response = await fetchWithTimeout(src, { 
                method: 'GET', 
                referrerPolicy: 'no-referrer',
                credentials: 'omit'
            }, 10000, signal);
            
            let blob = await response.blob();
            let mimeType = blob.type;
            let extension = getExtensionFromMime(mimeType);
            
            // 修正 DOM 里的 src
            if (src.startsWith('/')) {
                src = location.origin + src;
                img.setAttribute('src', src);
            } else if (!src.startsWith('http')) {
                // 处理其他相对路径情况 (如 ./img.jpg)，虽然 ESJ 较少见
                try {
                    src = new URL(src, location.href).href;
                    img.setAttribute('src', src);
                } catch (e) { 
                    console.warn(`非法 URL: ${src}`, e);
                 }
            }

            // 如果图片大于 100KB，尝试压缩
            if (blob.size > 100 * 1024) {

                const compressedBlob = await compressImage(blob);
                
                // 压缩完 blob 变了，更新类型信息
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

            // 移除原始 src，设置一个临时属性，防止浏览器去请求原图
            img.removeAttribute('src');
            img.setAttribute('data-epub-src', imageFilename);
            
            // 清理干扰属性
            img.removeAttribute('srcset');
            img.removeAttribute('loading');
            img.style.maxWidth = '100%'; 

        } catch (e) {
            console.warn(`图片下载失败: ${src}`, e);
            
            // 依然要清理干扰属性，防止阅读器解析错误
            img.removeAttribute('srcset');
            img.removeAttribute('loading');
            img.style.maxWidth = '100%';
            
            // 给 alt 增加失败提示
            const originalAlt = img.getAttribute('alt') || '';
            img.setAttribute('alt', `${originalAlt} (图片下载失败，使用远程链接)`);
        }
    }

    // 还原 HTML，替换 data-epub-src 为 src
    let finalHtml = div.innerHTML;
    finalHtml = finalHtml.replace(/data-epub-src="/g, 'src="');

    return {
        processedHtml: finalHtml,
        images
    };
}