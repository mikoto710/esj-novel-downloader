import { state, setAbortFlag } from '../core/state';
import { log } from '../utils/index';
import { fullCleanup } from '../utils/dom';
import { createConfirmPopup } from '../ui/popups';
import { batchDownload, DownloadTask } from '../core/downloader';

// 获取书籍 ID
function getBookId(): string {
    const match = location.href.match(/\/detail\/(\d+)/);
    return match ? match[1] : 'unknown';
}

/**
 * 解析详情页的章节列表并启动下载
 */
export async function scrapeDetail(): Promise<void> {
    setAbortFlag(false);
    state.originalTitle = document.title;

    return new Promise((resolveMain) => {
        createConfirmPopup(async () => {
            // 解析 DOM 获取任务列表
            const chaptersNodes = Array.from(document.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];
            
            if (chaptersNodes.length === 0) {
                alert("未找到章节列表 #chapterList");
                fullCleanup(state.originalTitle);
                return resolveMain();
            }

            // 构造任务队列
            const tasks: DownloadTask[] = chaptersNodes.map((node, index) => ({
                index: index,
                url: node.href,
                title: (node.getAttribute("data-title") || node.innerText || "").trim()
            }));

            // 解析元数据
            let bookName = (document.querySelector("h2.p-t-10.text-normal") as HTMLElement)?.innerText.trim() || "未命名";
            const symbolMap: Record<string, string> = { "\\": "-", "/": "- ", ":": "：", "*": "☆", "?": "？", "\"": " ", "<": "《", ">": "》", "|": "-", ".": "。", "\t": " ", "\n": " " };
            const escapeFileName = (name: string) => {
                for (let k in symbolMap) name = name.replace(new RegExp("\\" + k, "g"), symbolMap[k]);
                return name;
            };
            bookName = escapeFileName(bookName);

            let introTxt = `书名: ${bookName}\nURL: ${location.href}\n\n`;
            introTxt += ((document.querySelector("ul.book-detail") as HTMLElement)?.innerText || "") + "\n\n";
            document.querySelectorAll(".out-link a").forEach(a => {
                introTxt += `${(a as HTMLElement).innerText}：\n${(a as HTMLAnchorElement).href}\n`;
            });
            introTxt += "\n\n";
            introTxt += ((document.querySelector("#details") as HTMLElement)?.innerText || "") + "\n\n";

            // 获取封面 URL
            const imgNode = document.querySelector(".product-gallery img") as HTMLImageElement;
            const coverUrl = imgNode ? imgNode.src : undefined;

            // 调用通用下载器
            await batchDownload({
                bookId: getBookId(),
                bookName,
                introTxt,
                coverUrl,
                tasks
            });

            return resolveMain();

        }, () => {
            log("用户取消确认");
            return resolveMain();
        });
    });
}