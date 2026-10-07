/**
 * 转义 XML 与 HTML 特殊字符，空值返回空字符串
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
