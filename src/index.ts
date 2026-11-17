import { injectDetailButton } from "./ui/pages/detail";
import { injectSinglePageButton } from "./ui/pages/single";
import { injectForumButton } from "./ui/pages/forum";
import { injectStyles } from "./ui/styles";
import { installRuntimeInterfaceLocaleSync, subscribeInterfaceLocaleChange, t } from "./ui/locale";
import { refreshUiLogTruncationText, setUiLogTruncationFormatter } from "./ui/log-view";

setUiLogTruncationFormatter((count) => t("log.truncated", { count }));
subscribeInterfaceLocaleChange(() => refreshUiLogTruncationText());

(function init() {
    injectStyles();
    installRuntimeInterfaceLocaleSync();
    const url = location.href;

    const route = [
        {
            matches: url.includes("/detail/"),
            selector: ".sp-buttons",
            buttonId: "#btn-download-book",
            inject: injectDetailButton
        },
        {
            matches: url.includes("/forum/") && url.endsWith(".html"),
            selector: ".entry-navigation",
            buttonId: "#btn-download-single",
            inject: injectSinglePageButton
        },
        {
            matches: url.includes("/forum/"),
            selector: ".forum-list-page",
            buttonId: "#btn-download-forum",
            inject: injectForumButton
        }
    ].find((candidate) => candidate.matches);
    if (!route) {
        return;
    }

    // 初次检查、目录替换与轮询共用当前页面的挂载规则
    const tryInject = () => {
        if (document.querySelector(route.selector)) {
            route.inject();
        }
    };
    tryInject();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    continue;
                }
                const element = node as Element;
                if (element.matches(route.selector) || element.querySelector(route.selector)) {
                    route.inject();
                    return;
                }
            }
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // 保留挂载点未产生新增节点时的兜底，已有下载按钮时不重复注入
    const timer = setInterval(() => {
        if (!document.querySelector(route.buttonId)) {
            tryInject();
        }
    }, 1000);
    setTimeout(() => {
        observer.disconnect();
        clearInterval(timer);
    }, 30000);
})();
