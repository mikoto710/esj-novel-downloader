/**
 * 根据章节页面 URL 解析图片地址
 * 协议相对地址使用图片自身域名，不回退到 ESJZone 域名
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
