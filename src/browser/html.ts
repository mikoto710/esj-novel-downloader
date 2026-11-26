/**
 * 在惰性模板中解析 HTML 片段，不触发其中的资源加载
 */
export function parseInertHtml(html: string): HTMLTemplateElement {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template;
}
