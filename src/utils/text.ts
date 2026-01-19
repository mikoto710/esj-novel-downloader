/**
 * XML/HTML 特殊字符转义
 * @param s 输入字符串
 * @return 转义后的字符串
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

/**
 * 转义 HTML 并保留换行符
 * @param s HTML 字符串
 * @return 转义后的字符串
 */
export function escapeHtmlPreserveLine(s: string | null | undefined): string {
    if (!s) {
        return "";
    }
    // 先转义特殊字符
    const escaped = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // 按换行符分割，过滤空行，转为 <p> 标签
    const parts = escaped
        .split(/\n{2,}|\r\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    return parts.map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n");
}

/**
 * 将 HTML 字符串转换为符合 XHTML 标准的字符串 (用于 EPUB)
 * @param htmlString 输入的 HTML 字符串
 * @return 转换后的 XHTML 字符串
 */
export function convertToXhtml(htmlString: string): string {
    if (!htmlString) {
        return "";
    }

    // 使用 DOMParser 不会加载 img src，避免 console 报错
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");

    // 清洗 DOM 树：移除所有带冒号的非法属性
    const allElements = doc.body.querySelectorAll("*");

    // XML 属性名正则
    const validXmlNameRegex = /^[a-zA-Z_:][a-zA-Z0-9_\-.:]*$/;

    allElements.forEach((el) => {
        const attrs = Array.from(el.attributes);

        for (const attr of attrs) {
            const name = attr.name;

            // 检查语法合法性
            if (!validXmlNameRegex.test(name)) {
                // console.warn(`[XHTML Fix] 移除非法格式属性: ${name}`);
                el.removeAttribute(name);
                continue;
            }

            // 检查冒号命名空间
            if (name.includes(":")) {
                // 只保留标准的 xml/xmlns 命名空间
                if (!name.startsWith("xmlns") && !name.startsWith("xml")) {
                    // console.warn(`[XHTML Fix] 移除未知命名空间属性: ${name}`);
                    el.removeAttribute(name);
                }
            }
        }
    });

    // 使用 XMLSerializer 进行序列化
    const serializer = new XMLSerializer();

    const xhtmlParts: string[] = [];

    Array.from(doc.body.childNodes).forEach((node) => {
        try {
            let str = serializer.serializeToString(node);

            // 移除 XMLSerializer 自动添加的冗余 xmlns
            str = str.replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, "");

            xhtmlParts.push(str);
        } catch (e) {
            console.warn("XHTML 序列化节点失败:", node, e);
        }
    });

    return xhtmlParts.join("");
}

/**
 * 移除 HTML 字符串中的所有 img 标签
 */
export function removeImgTags(html: string): string {
    return html.replace(/<img[^>]*>/gi, "");
}
