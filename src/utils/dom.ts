interface ElementCleanupState {
    callbacks: Set<() => void>;
    observer: MutationObserver | null;
}

const elementCleanupStates = new WeakMap<Element, ElementCleanupState>();

function runElementCleanup(element: Element): void {
    const state = elementCleanupStates.get(element);
    if (!state) {
        return;
    }
    elementCleanupStates.delete(element);
    state.observer?.disconnect();
    state.callbacks.forEach((callback) => {
        try {
            callback();
        } catch (error) {
            console.error("Element cleanup failed", error);
        }
    });
}

/**
 * 注册与元素生命周期绑定的清理回调；外部移除元素时也会执行
 */
export function registerElementCleanup(element: Element, callback: () => void): () => void {
    let state = elementCleanupStates.get(element);
    if (!state) {
        const MutationObserverClass = element.ownerDocument.defaultView?.MutationObserver;
        state = {
            callbacks: new Set(),
            observer: MutationObserverClass
                ? new MutationObserverClass(() => {
                      if (!element.isConnected) {
                          runElementCleanup(element);
                      }
                  })
                : null
        };
        elementCleanupStates.set(element, state);
        state.observer?.observe(element.ownerDocument.documentElement, { childList: true, subtree: true });
    }
    state.callbacks.add(callback);

    let registered = true;
    return () => {
        if (!registered) {
            return;
        }
        registered = false;
        const current = elementCleanupStates.get(element);
        if (!current) {
            return;
        }
        current.callbacks.delete(callback);
        if (current.callbacks.size === 0) {
            current.observer?.disconnect();
            elementCleanupStates.delete(element);
        }
    };
}

/**
 * 在移除元素前同步执行其生命周期清理
 */
export function removeElement(element: Element | null | undefined): void {
    if (!element) {
        return;
    }
    runElementCleanup(element);
    element.remove();
}

/**
 * 启用弹窗拖拽功能
 * @param popup 弹窗的容器元素
 * @param headerSelector 拖拽手柄的选择器 (如 #header)
 */
export function enableDrag(popup: HTMLElement, headerSelector: string): void {
    const header = popup.querySelector(headerSelector) as HTMLElement | null;
    if (!header) {
        return;
    }

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
        if (!dragging) {
            return;
        }
        popup.style.left = e.clientX - offsetX + "px";
        popup.style.top = e.clientY - offsetY + "px";
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
 * @param originalTitle 原始标题
 */
export function fullCleanup(originalTitle?: string): void {
    const selectors = [
        "#esj-popup",
        "#esj-min-tray",
        "#esj-confirm",
        "#esj-book-lock",
        "#esj-format",
        "#esj-settings",
        "#esj-image-setting-task-confirm",
        "#esj-cache-manager",
        "#esj-cache-confirm",
        "#esj-cache-protection-notice",
        "#esj-download-history",
        "#esj-download-history-confirm",
        "#esj-diagnostics",
        "#esj-diagnostic-clear-confirm",
        "#esj-image-cache-confirm",
        "#esj-mapping-confirm",
        "#esj-mapping-export-confirm",
        "#esj-message-popup",
        "#esj-range-selection",
        "#esj-range-replace-confirm"
    ];

    selectors.forEach((sel) => removeElement(document.querySelector(sel)));

    if (originalTitle) {
        document.title = originalTitle;
    }
}

/**
 * 快速创建带属性和子元素的 DOM 节点
 * @param tag 标签名
 * @param attrs 属性对象
 * @param children 子元素数组
 */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, any> = {},
    children: (string | Node)[] = []
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "style" && typeof value === "object") {
            Object.assign(element.style, value);
        } else if (key.startsWith("on") && typeof value === "function") {
            element.addEventListener(key.substring(2).toLowerCase(), value as EventListener);
        } else if (key === "className") {
            element.className = value;
        } else if (["checked", "value", "disabled", "selected"].includes(key)) {
            (element as any)[key] = value;
        } else {
            element.setAttribute(key, String(value));
        }
    }
    children.forEach((child) => {
        if (typeof child === "string" || typeof child === "number") {
            element.appendChild(document.createTextNode(String(child)));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    });
    return element;
}
