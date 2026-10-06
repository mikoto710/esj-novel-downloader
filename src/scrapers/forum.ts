import { getForumBookId, loadForumBook } from "../site/book";
import { t } from "../ui/locale";
import { browserDiagnosticLog as log } from "../adapters/browser-diagnostics";
import { runBookDownload } from "./book-download";

/**
 * 取得完整目录并进入书籍下载流程
 */
export async function scrapeForum(): Promise<void> {
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
