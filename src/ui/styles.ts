import STYLES from "./styles.css?inline";

/**
 * 注入脚本界面样式
 */
export function injectStyles(): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLES;
    // 尝试插入 head，如果 document-start 阶段 head 不存在，则插入 html 根节点
    (document.head || document.documentElement).appendChild(styleEl);
}
