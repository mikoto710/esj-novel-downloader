import { parseBookMetadata } from "../core/parser";
import { t } from "../ui/locale";
import { browserDiagnosticLog as log } from "../adapters/browser-diagnostics";
import { BookPreflightError, runBookDownload } from "./book-download";

function getBookId(): string {
    const match = location.href.match(/\/detail\/(\d+)/);
    return match ? match[1] : "unknown";
}

/**
 * 取得完整目录并进入书籍下载流程
 */
export async function scrapeDetail(): Promise<void> {
    const bookId = getBookId();
    if (bookId === "unknown") {
        log(t("page.bookIdMissing"));
        return;
    }
    await runBookDownload({
        bookId,
        sourcePageType: "detail",
        pageTitle: document.title,
        async loadPlan() {
            const chapterLinks = Array.from(document.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];
            if (chapterLinks.length === 0) {
                throw new BookPreflightError("chapter-list-missing", "chapter-list");
            }
            return {
                tasks: chapterLinks.map((node, index) => ({
                    index,
                    url: node.href,
                    title: (node.getAttribute("data-title") || node.innerText || "").trim()
                })),
                meta: parseBookMetadata(document, location.href),
                pageUrl: location.href
            };
        }
    });
}
