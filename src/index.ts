import { injectDetailButton } from './ui/detail';
import { injectSinglePageButton } from './ui/single';
import { injectForumButton } from './ui/forum';
import { injectStyles } from './ui/styles';

(function init() {

    injectStyles();
    const url = location.href;

    // 路由
    const isDetailPage = url.includes('/detail/');
    const isForumPage = url.includes('/forum/') && !url.endsWith('.html');
    const isSinglePage = url.includes('/forum/') && url.endsWith('.html');

    // 定义通用的注入尝试函数
    const tryInject = () => {
        if (isDetailPage) {
            if (document.querySelector(".sp-buttons")) injectDetailButton();
        } else if (isSinglePage) {
            if (document.querySelector(".entry-navigation")) injectSinglePageButton();
        } else if (isForumPage) {
            if (document.querySelector(".forum-list-page")) injectForumButton();
        }
    };

    // 立即尝试一次
    tryInject();

    // 此时 body 可能还没生成，所以监听 documentElement 也就是 html 根节点
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
                if (node.nodeType === 1) {
                    const el = node as HTMLElement;

                    if (isDetailPage) {
                        // 详情页监听 .sp-buttons
                        if ((el.classList && el.classList.contains("sp-buttons")) ||
                            (el.querySelector && el.querySelector(".sp-buttons"))) {
                            injectDetailButton();
                            return;
                        }
                    } else if (isSinglePage) {
                        // 单页监听 .entry-navigation
                        if ((el.classList && el.classList.contains("entry-navigation")) ||
                            (el.querySelector && el.querySelector(".entry-navigation"))) {
                            injectSinglePageButton();
                            return;
                        }
                    } else if (isForumPage) {
                        // 论坛页监听 .forum-list-page
                        if ((el.classList && el.classList.contains("forum-list-page")) ||
                            (el.querySelector && el.querySelector(".forum-list-page"))) {
                            injectForumButton();
                            return;
                        }
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
        if (isDetailPage) {
            if (document.querySelector(".sp-buttons") && !document.querySelector("#btn-download-book")) {
                injectDetailButton();
            }
        } else if (isSinglePage) {
            if (document.querySelector(".entry-navigation") && !document.querySelector("#btn-download-single")) {
                injectSinglePageButton();
            }
        } else if (isForumPage) {
            if (document.querySelector(".forum-list-page") && !document.querySelector("#btn-download-forum")) {
                injectForumButton();
            }
        }
    }, 1000);

    // 超时自动清除
    setTimeout(() => {
        if (observer) observer.disconnect();
        if (timer) clearInterval(timer);
    }, 30000);

})();