import { log } from '../utils/index';
import { batchDownload, DownloadTask } from '../core/downloader';

interface ForumRow {
    subject: string;     // 包含链接的 HTML: <a href="...">标题</a>
    cdate: string;       // 发帖人/日期
    vtimes: string;      // 回复/观看
    last_reply: string;  // 最后回复
}

interface ForumResponse {
    status?: number;
    total: number;
    rows: ForumRow[];
}


// TODO: 调用列表接口 301 问题待解决
export async function scrapeForum(): Promise<void> {
    try {
        log("正在分析论坛列表信息...");

        // 获取 Bid (版块ID)
        // 策略: 优先从“发帖”按钮获取，其次从 URL 获取
        let bid = "";
        const addBtn = document.querySelector('a[href*="/add.html"]');
        if (addBtn) {
            const href = addBtn.getAttribute('href') || "";
            const match = href.match(/\/forum\/(\d+)\/add\.html/);
            if (match) bid = match[1];
        }

        if (!bid) {
            const urlParts = location.pathname.split('/').filter(p => p);
            for (let i = urlParts.length - 1; i >= 0; i--) {
                if (/^\d+$/.test(urlParts[i])) {
                    bid = urlParts[i];
                    break;
                }
            }
        }

        if (!bid) {
            alert("无法解析版块 ID (Bid)，请确保当前是有效的书籍目录页。");
            return;
        }

        log(`获取凭证成功: Bid=${bid}`);

        // 尝试获取 Token
        // const htmlContent = document.documentElement.innerHTML;
        // const tokenMatch = htmlContent.match(/token='(.+?)'/);
        // const token = tokenMatch ? tokenMatch[1] : "";

        // 构造 API URL 并强制 limit=9999 来拉取所有
        const params = new URLSearchParams({
            bid: bid,
            limit: '9999',
            offset: '0',
            sort: 'cdate', 
            order: 'asc'
        });

        const apiUrl = `${location.origin}/inc/forum_list_data.php?${params.toString()}`;
        
        log("正在请求章节列表 API...");
        
        let data: ForumResponse;
        try {
            const resp = await fetch(apiUrl);
            
            // 检查 HTTP 状态
            if (resp.status === 401 || resp.status === 403) {
                throw new Error("需要登录");
            }
            if (!resp.ok) throw new Error(`API Error: ${resp.status}`);

            // 尝试解析 JSON
            data = await resp.json();

        } catch (e) {
            console.error(e);
            alert("获取章节列表失败！\n\n可能原因：\n1. 您尚未登录 ESJZone (请登录后刷新重试)\n2. 网络连接问题\n3. 接口变动");
            return;
        }
        
        if (!data.rows || data.rows.length === 0) {
            alert("未找到任何文章/章节 (API 返回为空)。");
            return;
        }

        // 解析 JSON 中的 HTML 字符串
        const domParser = new DOMParser();
        const tasks: DownloadTask[] = [];

        data.rows.forEach((row, index) => {
            const doc = domParser.parseFromString(row.subject, 'text/html');
            const link = doc.querySelector('a');
            
            if (link && link.href) {
                tasks.push({
                    index: index,
                    url: link.href,
                    title: link.innerText.trim()
                });
            }
        });

        log(`解析完成，共发现 ${tasks.length} 个章节。`);

        // 获取元数据 (封面、书名、作者)
        let bookName = document.title.split(' - ')[0].trim();
        const titleEl = document.querySelector('.forum-detail h2');
        if (titleEl) bookName = titleEl.textContent?.trim() || bookName;

        const imgNode = document.querySelector(".product-gallery img") as HTMLImageElement;
        const coverUrl = imgNode ? imgNode.src : undefined;

        let author = "未知";
        const detailLis = document.querySelectorAll('ul.book-detail li');
        for (const li of Array.from(detailLis)) {
            const text = (li as HTMLElement).innerText || "";
            if (text.includes("作者")) {
                const link = li.querySelector('a');
                if (link) {
                    author = link.innerText.trim();
                } else {
                    author = text.replace(/作者[:：]/g, "").trim();
                }
                break;
            }
        }

        let detailText = "";
        const detailUl = document.querySelector('ul.book-detail');
        if (detailUl) detailText = (detailUl as HTMLElement).innerText + "\n";

        const introTxt = `书名: ${bookName}\n作者: ${author}\nURL: ${location.href}\n${detailText}\n共 ${tasks.length} 章\n\n`;

        // 开始批量下载
        await batchDownload({
            bookId: bid,
            bookName,
            introTxt,
            coverUrl,
            tasks
        });

    } catch (e: any) {
        console.error(e);
        alert("论坛抓取流程异常: " + e.message);
    }
}