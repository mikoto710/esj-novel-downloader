/**
 * 与原书任务索引对应的被动目录副本，不包含来源事件、地址或活动元素
 */
export interface BookDirectorySnapshot {
    readonly html: string;
    readonly chapterCount: number;
}

const PASSIVE_TAGS = new Set([
    "a",
    "div",
    "p",
    "span",
    "details",
    "summary",
    "ul",
    "ol",
    "li",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "small",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "code",
    "table",
    "tbody",
    "thead",
    "tr",
    "td",
    "th"
]);
const EXCLUDED_TAGS = new Set([
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "template",
    "noscript",
    "input",
    "textarea",
    "select"
]);
const TEXT_STYLES = ["color", "background-color", "font-size", "font-weight", "font-style", "text-decoration"];

/**
 * 保留安全的来源编排并绑定同一次枚举的索引；无法完整复制时交由视图使用任务列表
 */
export function createBookDirectorySnapshot(
    container: Element,
    chapterLinks: readonly HTMLAnchorElement[]
): BookDirectorySnapshot {
    const doc = container.ownerDocument;
    const indexes = new Map<Element, number>(chapterLinks.map((link, index) => [link, index]));
    const root = doc.createElement("div");
    let copied = 0;

    const copy = (node: Node): Node | null => {
        if (node.nodeType === 3) {
            return doc.createTextNode(node.nodeValue || "");
        }
        if (node.nodeType !== 1) {
            return null;
        }
        const element = node as Element;
        const tag = element.localName;
        if (EXCLUDED_TAGS.has(tag)) {
            return null;
        }
        const clone = PASSIVE_TAGS.has(tag) ? doc.createElement(tag) : doc.createDocumentFragment();
        if (clone.nodeType === 1) {
            const target = clone as HTMLElement;
            const index = indexes.get(element);
            if (index !== undefined) {
                target.setAttribute("data-esj-chapter-index", String(index));
                copied++;
            }
            if (tag === "details" && element.hasAttribute("open")) {
                target.setAttribute("open", "");
            }
            // 只带入文本外观，不复制定位、外部资源、选择标记和原站行为
            const style = doc.createElement("span").style;
            style.cssText = element.getAttribute("style") || "";
            for (const property of TEXT_STYLES) {
                const value = style.getPropertyValue(property);
                if (value && !/url\s*\(|expression\s*\(/i.test(value)) {
                    target.style.setProperty(property, value);
                }
            }
        }
        for (const child of Array.from(node.childNodes)) {
            const result = copy(child);
            if (result) {
                clone.appendChild(result);
            }
        }
        return clone;
    };
    try {
        for (const child of Array.from(container.childNodes)) {
            const result = copy(child);
            if (result) {
                root.appendChild(result);
            }
        }
        return Object.freeze({
            html: copied === chapterLinks.length ? root.innerHTML : "",
            chapterCount: chapterLinks.length
        });
    } catch {
        return Object.freeze({ html: "", chapterCount: chapterLinks.length });
    }
}
