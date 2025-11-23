import { state, setAbortFlag, setCachedData } from './state';
import { log, sleep } from '../utils/index';
import { fullCleanup } from '../utils/dom';
import { createDownloadPopup, createConfirmPopup, showFormatChoice } from '../ui/popups';
import { updateTrayText } from '../ui/tray';
import { loadBookCache, saveBookCache, clearBookCache } from './storage';
import { Chapter } from '../types';

// 获取书籍 ID
function getBookId(): string {
    const match = location.href.match(/\/detail\/(\d+)/);
    return match ? match[1] : 'unknown';
}

export async function doScrapeAndExport(): Promise<void> {
    setAbortFlag(false);
    state.originalTitle = document.title;

    const bookId = getBookId();
    
    let cachedCount = 0;
    const cacheResult = await loadBookCache(bookId);
    if (cacheResult.map) {
        state.globalChaptersMap = cacheResult.map;
        cachedCount = cacheResult.size;
    }

    return new Promise((resolveMain) => {
        createConfirmPopup(async () => {
            const popup = createDownloadPopup();
            const progressEl = document.querySelector("#esj-progress") as HTMLElement;
            const titleEl = document.querySelector("#esj-title") as HTMLElement;

            if (cachedCount > 0) {
                log(`💾 已从 IndexedDB 恢复 ${cachedCount} 章缓存`);
            }

            const chaptersNodes = Array.from(document.querySelectorAll("#chapterList a")) as HTMLAnchorElement[];
            
            if (chaptersNodes.length === 0) {
                alert("未找到章节列表 #chapterList");
                fullCleanup(state.originalTitle);
                return resolveMain();
            }
            const total = chaptersNodes.length;
            log(`发现 ${total} 个章节，准备开始抓取...`);

            // 元数据
            let bookName = (document.querySelector("h2.p-t-10.text-normal") as HTMLElement)?.innerText.trim() || "未命名";
            const symbolMap: Record<string, string> = { "\\": "-", "/": "- ", ":": "：", "*": "☆", "?": "？", "\"": " ", "<": "《", ">": "》", "|": "-", ".": "。", "\t": " ", "\n": " " };
            const escapeFileName = (name: string) => {
                for (let k in symbolMap) name = name.replace(new RegExp("\\" + k, "g"), symbolMap[k]);
                return name;
            };
            bookName = escapeFileName(bookName);

            let introTxt = `書名: ${bookName}\nURL: ${location.href}\n\n`;
            introTxt += ((document.querySelector("ul.book-detail") as HTMLElement)?.innerText || "") + "\n\n";
            document.querySelectorAll(".out-link a").forEach(a => {
                introTxt += `${(a as HTMLElement).innerText}：\n${(a as HTMLAnchorElement).href}\n`;
            });
            introTxt += "\n\n";
            introTxt += ((document.querySelector("#details") as HTMLElement)?.innerText || "") + "\n\n";

            // 下载封面附加超时处理
            const fetchCoverWithTimeout = async (url: string, timeout = 5000): Promise<Blob> => {
                const controller = new AbortController();
                const id = window.setTimeout(() => controller.abort(), timeout);
                try {
                    const response = await fetch(url, {
                        method: "GET",
                        referrerPolicy: "no-referrer",
                        credentials: "omit",
                        signal: controller.signal
                    });
                    window.clearTimeout(id);
                    if (!response.ok) throw new Error(`Status ${response.status}`);
                    return await response.blob();
                } catch (e) {
                    window.clearTimeout(id);
                    throw e;
                }
            };

            // 封面下载
            const coverTaskPromise = (async () => {
                try {
                    const imgNode = document.querySelector(".product-gallery img") as HTMLImageElement;
                    if (!imgNode) return null;

                    log("启动封面下载...");
                    const blob = await fetchCoverWithTimeout(imgNode.src, 15000);

                    if (blob.size < 1000) {
                        log("⚠ 封面文件过小，已忽略");
                        return null;
                    }

                    let ext: 'jpg' | 'png' = "jpg";
                    if (blob.type.includes("png")) ext = "png";
                    else if (blob.type.includes("jpeg") || blob.type.includes("jpg")) ext = "jpg";

                    log("✔ 封面下载完成");
                    return { blob, ext };
                } catch (e: any) {
                    log(`⚠ 封面下载跳过: ${e.message}`);
                    return null;
                }
            })();

            // 并发控制逻辑
            const CONCURRENCY = 3;
            let completedCount = 0;
            let queue = [...Array(total).keys()];

            async function processChapter(i: number) {
                if (state.abortFlag) return;

                const node = chaptersNodes[i];
                const chapterTitle = (node.getAttribute("data-title") || node.innerText || "").trim();
                const chapterUrl = node.href;

                if (state.globalChaptersMap.has(i)) {
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

                    if (i % 5 === 0) {
                        saveBookCache(bookId, state.globalChaptersMap);
                    }

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

                    const h2 = (doc.querySelector("h2") as HTMLElement)?.innerText || "";
                    const author = (doc.querySelector(".single-post-meta div") as HTMLElement)?.innerText.trim() || "";
                    const content = (doc.querySelector(".forum-content") as HTMLElement)?.innerText || "";

                    state.globalChaptersMap.set(i, {
                        title: h2 || chapterTitle,
                        content: content,
                        txtSegment: `${h2 || chapterTitle} [${author}]\n${content}\n\n`
                    });

                    if (completedCount % 5 === 0) {
                        saveBookCache(bookId, state.globalChaptersMap);
                    }
                } catch (e) {
                    log(`❌ 抓取失败：${e}`);
                } finally {
                    const delay = Math.floor(Math.random() * 200) + 100;
                    await sleep(delay);
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

            async function worker() {
                while (queue.length > 0 && !state.abortFlag) {
                    const index = queue.shift();
                    if (index !== undefined) {
                        await processChapter(index);
                    }
                }
            }

            log(`启动 ${CONCURRENCY} 个并发线程...`);
            const workers = [];
            for (let k = 0; k < CONCURRENCY; k++) {
                workers.push(worker());
            }
            await Promise.all(workers);

            if (state.abortFlag) {
                saveBookCache(bookId, state.globalChaptersMap);
                log("任务已手动取消，进度已保存。");
                document.title = state.originalTitle;
                return resolveMain();
            }

            // 完整性检查与补漏
            log("正在进行章节完整性检查...");
            const missingIndices: number[] = [];
            for (let i = 0; i < total; i++) {
                if (!state.globalChaptersMap.has(i)) missingIndices.push(i);
            }

            if (missingIndices.length > 0) {
                log(`⚠ 发现 ${missingIndices.length} 个章节抓取失败或遗漏，尝试自动补抓...`);
                for (const i of missingIndices) {
                    if (state.abortFlag) { saveBookCache(bookId, state.globalChaptersMap); break; }
                    log(`补抓 [${i + 1}/${total}]...`);
                    await processChapter(i);
                    saveBookCache(bookId, state.globalChaptersMap);
                    const delay = Math.floor(Math.random() * 200) + 100;
                    await sleep(delay);
                }
            } else {
                log("✅ 完整性检查通过，无缺漏。");
            }

            const coverResult = await coverTaskPromise;
            const finalCoverBlob = coverResult ? coverResult.blob : null;
            const finalCoverExt = coverResult ? coverResult.ext : "jpg";

            log("✅ 所有任务处理完毕");
            document.title = state.originalTitle;

            let finalTxt = introTxt;
            const chaptersArr: Chapter[] = [];
            for (let i = 0; i < total; i++) {
                const item = state.globalChaptersMap.get(i);
                if (item) {
                    finalTxt += item.txtSegment;
                    chaptersArr.push({ title: item.title, content: item.content, txtSegment: item.txtSegment });
                } else {
                    finalTxt += `第 ${i + 1} 章 获取失败\n\n`;
                    chaptersArr.push({ title: `第 ${i + 1} 章 (缺失)`, content: "内容抓取失败。", txtSegment: "" });
                }
            }

            setCachedData({
                txt: finalTxt,
                chapters: chaptersArr,
                metadata: {
                    title: bookName,
                    author: "",
                    coverBlob: finalCoverBlob,
                    coverExt: finalCoverExt
                },
                epubBlob: null
            });

            clearBookCache(bookId);
            fullCleanup(state.originalTitle);
            showFormatChoice();
            return resolveMain();

        }, () => {
            log("用户取消确认");
            return resolveMain();
        });
    });
}