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

    // 构建按钮结构
    const btn = el('button', {
        id: 'btn-download-book',
        className: 'btn btn-info m-b-10',
        style: 'margin-left: 10px;',
        onclick: () => {

            // 防止弹窗已存在的情景
            const runningPopup = document.querySelector("#esj-popup") as HTMLElement;
            if (runningPopup) {
                // 恢复弹窗显示
                runningPopup.style.display = "flex";
                // 有托盘就顺手删掉
                document.querySelector("#esj-min-tray")?.remove();
                return;
            }

            if (document.querySelector("#esj-confirm") || document.querySelector("#esj-format")) {
                return;
            }

            if (state.cachedData) {
                showFormatChoice();
                return;
            }

            doScrapeAndExport().catch((e: Error) => console.error("主流程异常: " + e.message));
        }
    }, [
        el('i', { className: 'icon-download' }),
        ' 全本下载'
    ]);

    btnGroup.appendChild(btn);
}