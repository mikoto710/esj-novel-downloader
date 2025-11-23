import { state, setAbortFlag, setCachedData } from './state.js';
import { log, sleep } from '../utils/index.js';
import { fullCleanup } from '../utils/dom.js';
import { createDownloadPopup, createConfirmPopup, showFormatChoice } from '../ui/popups.js';
import { updateTrayText } from '../ui/tray.js';

export async function doScrapeAndExport() {
    setAbortFlag(false);
    state.originalTitle = document.title;

    return new Promise((resolveMain) => {
        createConfirmPopup(async () => {
            const popup = createDownloadPopup();
            const progressEl = document.querySelector("#esj-progress");
            const titleEl = document.querySelector("#esj-title");

            const chaptersNodes = [...document.querySelectorAll("#chapterList a")];
            if (chaptersNodes.length === 0) {
                alert("未找到章节列表 #chapterList");
                fullCleanup(state.originalTitle);
                return resolveMain();
            }
            const total = chaptersNodes.length;
            log(`发现 ${total} 个章节，准备开始抓取...`);

            // 元数据
            let bookName = document.querySelector("h2.p-t-10.text-normal")?.innerText.trim() || "未命名小说";
            const symbolMap = { "\\": "-", "/": "- ", ":": "：", "*": "☆", "?": "？", "\"": " ", "<": "《", ">": "》", "|": "-", ".": "。", "\t": " ", "\n": " " };
            const escapeFileName = (name) => {
                for (let k in symbolMap) name = name.replace(new RegExp("\\" + k, "g"), symbolMap[k]);
                return name;
            };
            bookName = escapeFileName(bookName);

            let introTxt = `書名: ${bookName}\nURL: ${location.href}\n\n`;
            introTxt += (document.querySelector("ul.book-detail")?.innerText || "") + "\n\n";
            document.querySelectorAll(".out-link a").forEach(a => {
                introTxt += `${a.innerText}：\n${a.href}\n`;
            });
            introTxt += "\n\n";
            introTxt += (document.querySelector("#details")?.innerText || "") + "\n\n";

            // 封面下载
            let coverBlob = null;
            let coverExt = "jpg";
            try {
                const imgNode = document.querySelector(".product-gallery img");
                if (imgNode) {
                    const src = imgNode.src;
                    log("正在下载封面...");
                    const resp = await fetch(src, { method: "GET", referrerPolicy: "no-referrer", credentials: "omit" });
                    if (resp.ok) {
                        coverBlob = await resp.blob();
                        if (coverBlob.size < 1000) {
                            log("⚠ 封面过小，跳过"); coverBlob = null;
                        } else {
                            const type = coverBlob.type;
                            if (type.includes("png")) coverExt = "png";
                            else if (type.includes("jpeg") || type.includes("jpg")) coverExt = "jpg";
                            log("✔ 封面下载成功");
                        }
                    }
                }
            } catch (e) { log("⚠ 封面下载失败"); }

            // 并发控制逻辑
            const CONCURRENCY = 2;
            let completedCount = 0;
            let queue = [...Array(total).keys()];

            async function processChapter(i) {
                if (state.abortFlag) return;

                const node = chaptersNodes[i];
                const chapterTitle = node.innerText.trim();
                const chapterUrl = node.href;

                // 断点续传检查
                if (state.globalChaptersMap.has(i)) {
                    log(`[${i + 1}/${total}] ${chapterTitle} (已缓存，跳过)`);
                    completedCount++;
                    updateProgress();
                    return;
                }

                log(`抓取 (${i + 1}/${total})：${chapterTitle}\nURL: ${chapterUrl}`);

                // 非站内链接处理
                if (!/esjzone\.cc\/forum\/\d+\/\d+\.html/.test(chapterUrl)) {
                    const msg = `${chapterUrl} {非站內連結}`;
                    state.globalChaptersMap.set(i, {
                        title: chapterTitle,
                        content: msg,
                        txtSegment: `${chapterTitle}\n${msg}\n\n`
                    });
                    completedCount++;
                    updateProgress();
                    await sleep(100);
                    return;
                }

                // 抓取逻辑
                try {
                    const res = await fetch(chapterUrl, { credentials: "include" });
                    const html = await res.text();
                    const doc = new DOMParser().parseFromString(html, "text/html");

                    const h2 = doc.querySelector("h2")?.innerText || "";
                    const author = doc.querySelector(".single-post-meta div")?.innerText.trim() || "";
                    const content = doc.querySelector(".forum-content")?.innerText || "";

                    state.globalChaptersMap.set(i, {
                        title: h2 || chapterTitle,
                        content: content,
                        txtSegment: `${h2 || chapterTitle} [${author}]\n${content}\n\n`
                    });

                    // 随机延迟：200ms ~ 400ms，防止请求过快
                    const delay = Math.floor(Math.random() * 200) + 200;
                    await sleep(delay);

                } catch (e) {
                    log(`❌ 抓取失败：${e}`);
                    // 失败不写入，依靠后续完整性检查补漏
                }

                completedCount++;
                updateProgress();
            }

            function updateProgress() {
                if (state.abortFlag) return;
                const statusStr = `全本下载（${completedCount}/${total}）`;
                if (titleEl) titleEl.textContent = "📘 " + statusStr;
                document.title = `[${completedCount}/${total}] ${state.originalTitle}`;
                updateTrayText(statusStr);
                if (progressEl) progressEl.style.width = (completedCount / total) * 100 + "%";
            }

            // Worker
            async function worker() {
                while (queue.length > 0 && !state.abortFlag) {
                    const index = queue.shift();
                    await processChapter(index);
                }
            }

            log(`启动 ${CONCURRENCY} 个并发线程...`);
            const workers = [];
            for (let k = 0; k < CONCURRENCY; k++) {
                workers.push(worker());
            }
            await Promise.all(workers);

            if (state.abortFlag) {
                log("任务已手动取消。");
                document.title = state.originalTitle;
                return resolveMain();
            }

            // 完整性检查与补漏
            log("正在进行章节完整性检查...");
            const missingIndices = [];
            for (let i = 0; i < total; i++) {
                if (!state.globalChaptersMap.has(i)) missingIndices.push(i);
            }

            if (missingIndices.length > 0) {
                log(`⚠ 发现 ${missingIndices.length} 个章节抓取失败或遗漏，尝试自动补抓...`);
                // 补漏时使用单线程
                for (const i of missingIndices) {
                    if (state.abortFlag) break;
                    log(`补抓 [${i + 1}/${total}]...`);
                    await processChapter(i);
                    await sleep(300);
                }
            } else {
                log("✅ 完整性检查通过，无缺漏。");
            }

            log("✅ 所有任务处理完毕");
            document.title = state.originalTitle;

            // 组装数据
            let finalTxt = introTxt;
            const chaptersArr = [];
            for (let i = 0; i < total; i++) {
                const item = state.globalChaptersMap.get(i);
                if (item) {
                    finalTxt += item.txtSegment;
                    chaptersArr.push({ title: item.title, content: item.content });
                } else {
                    finalTxt += `第 ${i + 1} 章 获取失败\n\n`;
                    chaptersArr.push({ title: `第 ${i + 1} 章 (缺失)`, content: "内容抓取失败。" });
                }
            }

            setCachedData({
                txt: finalTxt,
                chapters: chaptersArr,
                metadata: {
                    title: bookName,
                    author: "",
                    coverBlob: coverBlob, 
                    coverExt: coverExt
                },
                epubBlob: null
            });

            fullCleanup(state.originalTitle);
            showFormatChoice();
            return resolveMain();

        }, () => {
            log("用户取消确认");
            return resolveMain();
        });
    });
}