const NON_READING_ELEMENTS = new Set(
    "applet audio base button canvas datalist dialog embed fencedframe form frame frameset iframe input link meta noembed noframes noscript object optgroup option output param portal script select source style template textarea title track video".split(
        " "
    )
);

/**
 * 判断是否为可保留阅读内容的 HTML 元素，排除页面资源、表单与嵌入内容
 */
export function isReadingElement(node: Node): node is HTMLElement {
    return node instanceof HTMLElement && !NON_READING_ELEMENTS.has(node.localName);
}
