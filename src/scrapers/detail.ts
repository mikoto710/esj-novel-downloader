import { getDetailBookId, loadDetailBook } from "../site/book";
import { t } from "../ui/locale";
import { browserDiagnosticLog as log } from "../adapters/browser-diagnostics";
import { runBookDownload } from "./book-download";

/**
 * 取得完整目录并进入书籍下载流程
 */
export async function scrapeDetail(): Promise<void> {
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
