import { getForumBookId, loadForumBook } from "../../site/book";
import { t } from "../locale";
import { browserDiagnosticLog as log } from "../../adapters/browser-diagnostics";
import { runBookDownload } from "../../app/book-download";
import { el } from "../../utils/dom";
import { createDownloadButton, createSettingButton } from "../components";

/**
 * 在论坛版块页注入 下载 按钮
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

    const downloadBtn =
        document.querySelector<HTMLElement>("#btn-download-forum") ||
        createDownloadButton("btn-download-forum", undefined, scrapeForum, "");
    const settingBtn = container.querySelector<HTMLElement>(".esj-settings-trigger") || createSettingButton();

    // 保留论坛原生操作顺序，只规范化脚本自身两个入口的尾部顺序
    container.append(downloadBtn, settingBtn);
}

/**
 * 取得完整目录并进入书籍下载流程
 */
async function scrapeForum(): Promise<void> {
    const bookId = getForumBookId(location.pathname);
    if (!bookId) {
        log(t("page.bookIdMissing"));
        return;
    }
    await runBookDownload({
        bookId,
        sourcePageType: "forum",
        pageTitle: document.title,
        loadPlan: () => loadForumBook(bookId, location.origin)
    });
}
