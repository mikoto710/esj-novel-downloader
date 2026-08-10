import { el } from "../utils/dom";
import { scrapeForum, scrapeForumRange } from "../scrapers/forum";
import { createDownloadButton, createRangeDownloadButton, createSettingButton } from "./components";

/**
 * 在论坛版块页注入 "全本下载" 按钮
 */
export function injectForumButton(): void {
    // 找到包含发帖按钮的 column
    let container = document.querySelector(".forum-list-page .column");

    // 找不到容器时插入到 .table-responsive 前
    if (!container) {
        const tableEl = document.querySelector(".table-responsive");

        if (tableEl && tableEl.parentElement) {
            container = el("div", { className: "column" });
            const wrapper = el("div", { className: "forum-list-page m-b-20" }, [
                container,
                el("div", { className: "column" })
            ]);

            // 插入到表格节点之前
            tableEl.parentElement.insertBefore(wrapper, tableEl);
        }
    }

    if (!container) {
        return;
    }

    let settingBtn = container.querySelector<HTMLElement>(".esj-settings-trigger");
    if (!document.querySelector("#btn-download-forum")) {
        const downloadBtn = createDownloadButton("btn-download-forum", undefined, scrapeForum, "");
        container.insertBefore(downloadBtn, container.firstChild);
    }
    if (!document.querySelector("#btn-download-forum-range")) {
        const rangeDownloadBtn = createRangeDownloadButton("btn-download-forum-range", scrapeForumRange);
        container.insertBefore(rangeDownloadBtn, settingBtn);
    }
    if (!settingBtn) {
        settingBtn = createSettingButton();
        container.appendChild(settingBtn);
    }
}
