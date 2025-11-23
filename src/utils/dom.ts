/**
 * 启用弹窗拖拽功能
 * @param popup 弹窗的容器元素
 * @param headerSelector 拖拽手柄的选择器 (如 #header)
 */
export function enableDrag(popup: HTMLElement, headerSelector: string): void {
    const header = popup.querySelector(headerSelector) as HTMLElement | null;
    if (!header) return;

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener("mousedown", (e: MouseEvent) => {
        dragging = true;
        const rect = popup.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp, { once: true });
    });

    function onMove(e: MouseEvent): void {
        if (!dragging) return;
        popup.style.left = (e.clientX - offsetX) + "px";
        popup.style.top = (e.clientY - offsetY) + "px";
        // 清除 transform 防止定位冲突
        popup.style.transform = "none";
    }

    function onUp(): void {
        dragging = false;
        document.removeEventListener("mousemove", onMove);
    }
}


/**
 * 清理所有弹窗和悬浮球，并恢复标题
 */
export function fullCleanup(originalTitle?: string): void {
    const selectors = [
        "#esj-popup", 
        "#esj-min-tray", 
        "#esj-confirm", 
        "#esj-format"
    ];

    selectors.forEach(sel => {
        document.querySelector(sel)?.remove();
    });

    if (originalTitle) {
        document.title = originalTitle;
    }
}

/**
 * 快速创建带属性和子元素的 DOM 节点
 */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, any> = {},
    children: (string | Node)[] = []
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.substring(2).toLowerCase(), value as EventListener);
        } else if (key === 'className') {
            element.className = value;
        } else {
            element.setAttribute(key, String(value));
        }
    }
    children.forEach(child => {
        if (typeof child === 'string' || typeof child === 'number') {
            element.appendChild(document.createTextNode(String(child)));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    });
    return element;
}