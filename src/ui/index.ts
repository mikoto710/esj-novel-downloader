import { state } from '../core/state';
import { doScrapeAndExport } from '../core/scraper';
import { showFormatChoice } from './popups';
import { el } from '../utils/dom';

/**
 * 向页面注入“全本下载”按钮
 */
export function injectButton(): void {
    const btnGroup = document.querySelector(".sp-buttons");
    if (!btnGroup) return;
    
    // 防止重复注入
    if (document.querySelector("#btn-download-book")) return;

    // 使用 el 构建按钮结构：<button> <i class="..."></i> 全本下载 </button>
    const btn = el('button', {
        id: 'btn-download-book',
        className: 'btn btn-info m-b-10',
        style: 'margin-left: 10px;',
        onclick: () => {
            if (state.cachedData) {
                showFormatChoice();
            } else {
                doScrapeAndExport().catch((e: Error) => console.error("主流程异常: " + e.message));
            }
        }
    }, [
        el('i', { className: 'icon-download' }), // 图标
        ' 全本下载' // 文本节点
    ]);

    btnGroup.appendChild(btn);
}