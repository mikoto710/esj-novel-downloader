/**
 * XML/HTML 特殊字符转义
 */
export function escapeXml(s: string | null | undefined): string {
    if (!s) return "";
    return s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
}

/**
 * 转义 HTML 并保留换行符
 */
export function escapeHtmlPreserveLine(s: string | null | undefined): string {
    if (!s) return "";
    // 先转义特殊字符
    const escaped = s.replace(/&/g, "&amp;")
                     .replace(/</g, "&lt;")
                     .replace(/>/g, "&gt;");
    
    // 按换行符分割，过滤空行，转为 <p> 标签
    const parts = escaped.split(/\n{2,}|\r\n{2,}/)
                         .map(p => p.trim())
                         .filter(p => p.length > 0);
                         
    return parts.map(p => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n");
}