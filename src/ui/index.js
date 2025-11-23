import { state } from '../core/state.js';
import { doScrapeAndExport } from '../core/scraper.js';
import { showFormatChoice } from './popups.js';

export function injectButton() {
    const btnGroup = document.querySelector(".sp-buttons");
    if (!btnGroup) return;
    if (document.querySelector("#btn-download-book")) return;

    const btn = document.createElement("button");
    btn.id = "btn-download-book";
    btn.className = "btn btn-info m-b-10";
    btn.style.marginLeft = "10px";
    btn.innerHTML = `<i class="icon-download"></i> 全本下载`;

    btn.onclick = () => {
        if (state.cachedData) {
            showFormatChoice();
        } else {
            doScrapeAndExport().catch(e => console.error("主流程异常: " + e.message));
        }
    };
    btnGroup.appendChild(btn);
}