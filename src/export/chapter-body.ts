import { isValidChapterImage } from "../content/image-format";
import type { Chapter } from "../content/model";
import { isReadingElement } from "../content/reading-markup";
import { parseInertHtml } from "../browser/html";

const READING_TAGS = new Set(
    "a abbr address article aside b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr".split(
        " "
    )
);
const GLOBAL_ATTRIBUTES = new Set(["class", "dir", "id", "lang", "title"]);
const READING_ATTRIBUTES: Record<string, string[]> = {
    caption: ["align"],
    col: ["span", "width"],
    colgroup: ["span", "width"],
    details: ["open"],
    div: ["align"],
    font: ["color", "face", "size"],
    img: ["alt", "height", "src", "width"],
    li: ["value"],
    ol: ["reversed", "start", "type"],
    p: ["align"],
    table: ["align", "border", "cellpadding", "cellspacing", "width"],
    td: ["align", "colspan", "headers", "rowspan", "valign", "width"],
    th: ["align", "colspan", "headers", "rowspan", "scope", "valign", "width"],
    tr: ["align", "valign"]
};
const READING_STYLES =
    "background-color border border-bottom border-collapse border-left border-right border-spacing border-top color direction font font-family font-feature-settings font-size font-style font-variant font-weight height letter-spacing line-height margin margin-bottom margin-left margin-right margin-top max-width padding padding-bottom padding-left padding-right padding-top text-align text-decoration text-indent text-transform vertical-align white-space width word-spacing".split(
        " "
    );

/**
 * 仅返回媒体类型与 Blob 匹配且可用作包内图片文件名的资源
 */
export function getChapterExportImages(chapter: Chapter) {
    return (chapter.images || []).filter(
        (image) => isValidChapterImage(image) && /^img_\d+_\d+\.(?:jpg|png|gif|webp)$/.test(image.id)
    );
}

/**
 * 保留有完整地址的 HTTP、HTTPS 阅读链接
 */
export function readingHref(value: string): string | null {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

/**
 * 从正文和已绑定的图片资源生成静态阅读内容，可序列化为 HTML 或 XHTML
 */
export function createStaticChapterBody(
    html: string,
    imageSource: ((src: string) => string | null) | null
): HTMLTemplateElement {
    const template = parseInertHtml(html);

    function clean(node: ChildNode) {
        if (node.nodeType === Node.TEXT_NODE) {
            return;
        }
        if (!isReadingElement(node)) {
            node.remove();
            return;
        }
        const element = node;
        const tag = element.localName;
        Array.from(element.childNodes).forEach(clean);
        if (!READING_TAGS.has(tag)) {
            element.replaceWith(...Array.from(element.childNodes));
            return;
        }
        const href = tag === "a" && element.getAttribute("href")?.trim();
        if (tag === "img") {
            const src = element.getAttribute("src");
            const safeSrc = src && imageSource?.(src);
            if (!safeSrc) {
                const alt = imageSource && element.getAttribute("alt");
                if (alt) {
                    element.replaceWith(alt);
                } else {
                    element.remove();
                }
                return;
            }
            element.setAttribute("src", safeSrc);
        }
        const styles = element.hasAttribute("style")
            ? READING_STYLES.map((name) => [name, element.style.getPropertyValue(name)] as const).filter(
                  ([, value]) => value !== ""
              )
            : [];
        for (const name of element.getAttributeNames()) {
            if (!GLOBAL_ATTRIBUTES.has(name) && !READING_ATTRIBUTES[tag]?.includes(name)) {
                element.removeAttribute(name);
            }
        }
        for (const [name, value] of styles) {
            element.style.setProperty(name, value);
        }
        const safeHref = href ? (href.startsWith("#") ? href : readingHref(href)) : null;
        if (safeHref) {
            element.setAttribute("href", safeHref);
        }
    }

    Array.from(template.content.childNodes).forEach(clean);
    return template;
}
