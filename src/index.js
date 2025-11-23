import { injectButton } from './ui/index.js';
import { injectStyles } from './ui/styles.js';

// ESJ 前后端没分离，直接从 document-start 开始执行注入，避免评论区加载过慢影响按钮的加载
(function init() {
    // 注入 CSS 样式
    injectStyles(); 

    // 有页面缓存就直接注入
    if (document.querySelector(".sp-buttons")) {
        injectButton();
    }

    // 此时 body 可能还没生成，所以监听 documentElement 也就是 html 根节点
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    // 检查节点本身是否是目标
                    if (node.classList && node.classList.contains("sp-buttons")) {
                        injectButton();
                        return;
                    }
                    // 检查节点内部是否包含目标
                    if (node.querySelector && node.querySelector(".sp-buttons")) {
                        injectButton();
                        return;
                    }
                }
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // 兜底定时器，防止 observer 没扫到
    const timer = setInterval(() => {
        if (document.querySelector(".sp-buttons") && !document.querySelector("#btn-download-book")) {
            injectButton();
        }
    }, 1000);

    // 超时自动清除
    setTimeout(() => {
        if (observer) observer.disconnect();
        if (timer) clearInterval(timer);
    }, 30000);

})();