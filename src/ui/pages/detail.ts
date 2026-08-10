import { scrapeDetail, scrapeDetailRange } from "../../scrapers/detail";
import { createDownloadButton, createRangeDownloadButton, createSettingButton } from "../components";

/**
 * 向小说详情页注入 "全本下载" 按钮
 */
export function injectDetailButton(): void {
    const btnGroup = document.querySelector(".sp-buttons");
    if (!btnGroup) {
        return;
    }

    const downloadBtn =
        document.querySelector<HTMLElement>("#btn-download-book") ||
        createDownloadButton("btn-download-book", undefined, scrapeDetail, "m-b-10");
    const rangeDownloadBtn =
        document.querySelector<HTMLElement>("#btn-download-book-range") ||
        createRangeDownloadButton("btn-download-book-range", scrapeDetailRange, "m-b-10");
    const settingBtn = btnGroup.querySelector<HTMLElement>(".esj-settings-trigger") || createSettingButton("m-b-10");

    // 保留网站原生按钮顺序，只规范化脚本自身三个入口的尾部顺序
    btnGroup.append(downloadBtn, rangeDownloadBtn, settingBtn);
}
