import { el } from "../utils/dom";
import { downloadCurrentPage } from "../scrapers/single";

/**
 * 在单章阅读页注入 "下载本章" 按钮
 */
export function injectSinglePageButton(): void {
    // 定位中间的 column
    const viewAllBtn = document.querySelector(".entry-navigation .view-all");

    if (!viewAllBtn || !viewAllBtn.parentElement) {
        return;
    }

    const container = viewAllBtn.parentElement;

    // 防重复
    if (document.querySelector("#btn-download-single")) {
        return;
    }

    // 创建按钮 (TXT)
    const btnTxt = el(
        "a",
        {
            id: "btn-download-single",
            className: "btn btn-outline-secondary view-all",
            style: "margin-left: 5px; cursor: pointer;",
            title: "下载本章 (TXT)",
            onclick: (e: Event) => {
                e.preventDefault();
                downloadCurrentPage("txt");
            }
        },
        [el("i", { className: "icon-download" })]
    );

    // 创建按钮 (HTML)
    const btnHtml = el(
        "a",
        {
            id: "btn-download-single-html",
            className: "btn btn-outline-secondary view-all",
            style: "margin-left: 10px; cursor: pointer;",
            title: "下载本章 (HTML)",
            onclick: (e: Event) => {
                e.preventDefault();
                downloadCurrentPage("html");
            }
        },
        [el("i", { className: "icon-code" })]
    );

    // 插入到 "回整合" 按钮后面
    container.appendChild(btnTxt);
    container.appendChild(btnHtml);
}
