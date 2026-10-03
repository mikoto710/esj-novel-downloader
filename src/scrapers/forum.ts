import { parseBookMetadata } from "../core/parser";
import { t } from "../ui/locale";
import { browserDiagnosticLog as log } from "../adapters/browser-diagnostics";
import { BookPreflightError, runBookDownload } from "./book-download";

function getForumBookId(): string {
    const urlParts = location.pathname.split("/").filter(Boolean);
    for (let index = urlParts.length - 1; index >= 0; index--) {
        if (/^\d+$/.test(urlParts[index])) {
            return urlParts[index];
        }
    }
    return "";
}

/**
 * 取得完整目录并进入书籍下载流程
 */
export async function scrapeForum(): Promise<void> {
    const bookId = getForumBookId();
    if (!bookId) {
        log(t("page.bookIdMissing"));
        return;
    }
    await runBookDownload({
        bookId,
        sourcePageType: "forum",
        pageTitle: document.title,
        async loadPlan() {
            const detailUrl = `${location.origin}/detail/${bookId}.html`;
            let response: Response;
            try {
                response = await fetch(detailUrl);
                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}`);
                }
            } catch (error) {
                throw new BookPreflightError("detail-fetch-failed", "book-metadata", { cause: error });
            }
            const doc = new DOMParser().parseFromString(await response.text(), "text/html");
            const chapterLinks = Array.from(doc.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];
            if (chapterLinks.length === 0) {
                throw new BookPreflightError("chapter-list-missing", "chapter-list");
            }
            return {
                tasks: chapterLinks.map((node, index) => ({
                    index,
                    url: new URL(node.getAttribute("href") || node.href, detailUrl).href,
                    title: (node.getAttribute("data-title") || node.innerText || "").trim()
                })),
                meta: parseBookMetadata(doc, detailUrl),
                pageUrl: detailUrl
            };
        }
    });
}
