import { getDetailBookId, loadDetailBook } from "../../site/book";
import { t } from "../locale";
import { browserDiagnosticLog as log } from "../../diagnostics/runtime";
import { runBookDownload } from "../../app/book-download";
import { createDownloadButton, createSettingButton } from "../components";

/**
 * 向小说详情页注入 下载 按钮
 */
export function injectDetailButton(): void {
    const btnGroup = document.querySelector(".sp-buttons");
    if (!btnGroup) {
        return;
    }

    const downloadBtn =
        document.querySelector<HTMLElement>("#btn-download-book") ||
        createDownloadButton("btn-download-book", undefined, scrapeDetail, "m-b-10");
    const settingBtn = btnGroup.querySelector<HTMLElement>(".esj-settings-trigger") || createSettingButton("m-b-10");

    // 保留网站原生按钮顺序，只规范化脚本自身两个入口的尾部顺序
    btnGroup.append(downloadBtn, settingBtn);
}

/**
 * 取得完整目录并进入书籍下载流程
 */
async function scrapeDetail(): Promise<void> {
    const bookId = getDetailBookId(location.href);
    if (bookId === "unknown") {
        log(t("page.bookIdMissing"));
        return;
    }
    await runBookDownload({
        bookId,
        sourcePageType: "detail",
        pageTitle: document.title,
        async loadPlan() {
            return loadDetailBook(document, location.href);
        }
    });
}
