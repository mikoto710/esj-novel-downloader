import { el } from "../utils/dom";
import { scrapeForum } from "../scrapers/forum";
import { createDownloadButton, createSettingButton } from "./components";

/**
 * 在论坛版块页注入 "全本下载" 按钮
 */
export function injectForumButton(): void {
    // 防重复注入
    if (document.querySelector("#btn-download-forum")) {
        return;
    }

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

    const downloadBtn = createDownloadButton("btn-download-forum", undefined, scrapeForum, "");

    const settingBtn = createSettingButton();

    container.appendChild(downloadBtn);

    container.appendChild(settingBtn);
}
