/**
 * XML/HTML 特殊字符转义
 * @param s 输入字符串
 * @returns 转义后的字符串
 */
export function escapeXml(s: string | null | undefined): string {
    if (!s) {
        return "";
    }
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
