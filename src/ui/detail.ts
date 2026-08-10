import { scrapeDetail, scrapeDetailRange } from "../scrapers/detail";
import { createDownloadButton, createRangeDownloadButton, createSettingButton } from "./components";

/**
 * 向小说详情页注入 "全本下载" 按钮
 */
export function injectDetailButton(): void {
    const btnGroup = document.querySelector(".sp-buttons");
    if (!btnGroup) {
        return;
    }

    let settingBtn = btnGroup.querySelector<HTMLElement>(".esj-settings-trigger");
    if (!document.querySelector("#btn-download-book")) {
        const downloadBtn = createDownloadButton("btn-download-book", undefined, scrapeDetail, "m-b-10");
        btnGroup.insertBefore(downloadBtn, btnGroup.firstChild);
    }
    if (!document.querySelector("#btn-download-book-range")) {
        const rangeDownloadBtn = createRangeDownloadButton("btn-download-book-range", scrapeDetailRange, "m-b-10");
        btnGroup.insertBefore(rangeDownloadBtn, settingBtn);
    }
    if (!settingBtn) {
        settingBtn = createSettingButton("m-b-10");
        btnGroup.appendChild(settingBtn);
    }
}
