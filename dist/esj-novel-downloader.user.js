// ==UserScript==
// @name          ESJZone 全本下载
// @namespace     http://tampermonkey.net/
// @version       1.0.1
// @description   在 ESJZone 小说详情页注入 "全本下载" 按钮，支持 TXT/EPUB 导出
// @author        Shigure Sora
// @match         https://www.esjzone.cc/detail/*
// @match         https://www.esjzone.one/detail/*
// @match         https://www.esjzone.net/detail/*
// @match         https://www.esjzone.me/detail/*
// @run-at        document-start
// @grant         none
// ==/UserScript==

(function () {
    'use strict';

    const state = {
        abortFlag: false,
        originalTitle: document.title || 'ESJZone',
        cachedData: null,
        globalChaptersMap: new Map()
    };

    function setAbortFlag(val) {
        state.abortFlag = val;
    }

    function setCachedData(data) {
        state.cachedData = data;
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (window.JSZip) return resolve(window.JSZip);
            const s = document.createElement("script");
            s.src = src;
            s.onload = () => resolve(window.JSZip);
            s.onerror = () => reject(new Error("加载脚本失败: " + src));
            document.head.appendChild(s);
        });
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function log(msg) {
        const prefix = new Date().toLocaleTimeString();
        const line = `[${prefix}] ${msg}`;
        console.log(line);
        const box = document.querySelector("#esj-log");
        if (box) {
            box.textContent += line + "\n";
            box.scrollTop = box.scrollHeight;
        }
    }

    function escapeXml(s) {
        if (!s) return "";
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    }

    function escapeHtmlPreserveLine(s) {
        if (!s) return "";
        const escaped = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const parts = escaped.split(/\n{2,}|\r\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
        return parts.map(p => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n");
    }

    function enableDrag(popup, headerSelector) {
        const header = popup.querySelector(headerSelector);
        if (!header) return;
        let dragging = false, offsetX = 0, offsetY = 0;
        header.addEventListener("mousedown", (e) => {
            dragging = true;
            const rect = popup.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp, { once: true });
        });
        function onMove(e) {
            if (!dragging) return;
            popup.style.left = (e.clientX - offsetX) + "px";
            popup.style.top = (e.clientY - offsetY) + "px";
            popup.style.transform = "none";
        }
        function onUp() {
            dragging = false;
            document.removeEventListener("mousemove", onMove);
        }
    }

    function fullCleanup(originalTitle) {
        document.querySelector("#esj-popup")?.remove();
        document.querySelector("#esj-min-tray")?.remove();
        document.querySelector("#esj-confirm")?.remove();
        document.querySelector("#esj-format")?.remove();
        if (originalTitle) document.title = originalTitle;
    }

    function createMinimizedTray(progressText) {
        const old = document.querySelector("#esj-min-tray");
        if (old) old.remove();

        const tray = document.createElement("div");
        tray.id = "esj-min-tray";
        tray.title = "点击恢复下载窗口";
        tray.innerHTML = `<span>📘</span><span id="esj-tray-text">${progressText || "下载中..."}</span>`;

        tray.onclick = () => {
            const popup = document.querySelector("#esj-popup");
            if (popup) {
                popup.style.display = "flex";
                tray.remove();
            }
        };
        document.body.appendChild(tray);
        return tray;
    }

    function updateTrayText(text) {
        const el = document.querySelector("#esj-tray-text");
        if (el) el.textContent = text;
    }

    async function buildEpub(chapters, metadata) {
            try {
                await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
                if (!window.JSZip) throw new Error("JSZip 未就绪");
            } catch (e) {
                throw new Error("加载 JSZip 失败: " + e.message);
            }

            const zip = new JSZip();
            zip.file("mimetype", "application/epub+zip", { binary: true, compression: "STORE" });
            zip.folder("META-INF").file("container.xml",
                `<?xml version="1.0" encoding="utf-8"?>
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                </rootfiles>
            </container>`);

            const oebps = zip.folder("OEBPS");
            const manifestItems = [];
            const spineItems = [];

            let coverMeta = "";
            if (metadata.coverBlob) {
                const coverFilename = "cover." + metadata.coverExt;
                const coverMime = metadata.coverExt === "png" ? "image/png" : "image/jpeg";
                oebps.file(coverFilename, metadata.coverBlob);
                manifestItems.push(`<item id="cover-image" href="${coverFilename}" media-type="${coverMime}" properties="cover-image"/>`);
                coverMeta = `<meta name="cover" content="cover-image" />`;
            }

            let navHtml = `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
          <head><title>目录</title></head>
          <body>
            <nav epub:type="toc" id="toc">
              <h1>目录</h1>
              <ol>
        `;

            for (let i = 0; i < chapters.length; i++) {
                const id = `chap_${i + 1}`;
                const filename = `${id}.xhtml`;
                const title = chapters[i].title || (`第${i + 1}章`);
                const body = chapters[i].content || "";

                const xhtml = `<?xml version="1.0" encoding="utf-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
              <head><title>${escapeXml(title)}</title></head>
              <body>
                <h2>${escapeXml(title)}</h2>
                <div>${escapeHtmlPreserveLine(body)}</div>
              </body>
            </html>`;

                oebps.file(filename, xhtml);
                manifestItems.push(`<item id="${id}" href="${filename}" media-type="application/xhtml+xml"/>`);
                spineItems.push(`<itemref idref="${id}"/>`);
                navHtml += `<li><a href="${filename}">${escapeXml(title)}</a></li>`;
            }

            navHtml += `</ol></nav></body></html>`;
            oebps.file("nav.xhtml", navHtml);
            manifestItems.push(`<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`);

            const uniqueId = metadata.uuid || ("id-" + Date.now());
            const title = escapeXml(metadata.title || "未知書名");
            const author = escapeXml(metadata.author || "");
            const pubdate = new Date().toISOString();

            const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>${title}</dc:title>
            <dc:language>zh-CN</dc:language>
            <dc:identifier id="BookId">${uniqueId}</dc:identifier>
            <dc:creator>${author}</dc:creator>
            <dc:date>${pubdate}</dc:date>
            ${coverMeta}
          </metadata>
          <manifest>
            ${manifestItems.join("\n")}
          </manifest>
          <spine>
            ${spineItems.join("\n")}
          </spine>
        </package>`;

            oebps.file("content.opf", contentOpf);

            log("正在压缩生成 EPUB（可能需要几秒）...");
            const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
            return blob;
        }

    function createDownloadPopup() {
        fullCleanup(state.originalTitle);

        const popup = document.createElement("div");
        popup.id = "esj-popup";
        popup.style =
            "position: fixed; top: 18%; left: 50%; transform: translateX(-50%); width: 520px; height: 460px; background: #fff; border-radius: 8px; border: 1px solid #aaa; box-shadow: 0 0 18px rgba(0,0,0,0.28); z-index: 999999; display:flex;flex-direction:column;";

        popup.innerHTML = `
            <div id="esj-header" style="padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;">
                <span id="esj-title">📘 全本下载任务</span>
                <div style="display:flex;gap:8px;">
                    <button id="esj-min" title="最小化" style="border:none;background:#81d4fa;color:#000;padding:2px 10px;border-radius:4px;cursor:pointer;font-weight:bold;line-height:1.2;">_</button>
                    <button id="esj-close" title="关闭" style="border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;">✕</button>
                </div>
            </div>

            <div style="padding:12px;">
                <div style="font-size:13px;margin-bottom:8px;">进度：</div>
                <div style="width:100%;height:14px;background:#eee;border-radius:8px;overflow:hidden;">
                    <div id="esj-progress" style="width:0%;height:100%;background:#2b9bd7;transition:width .2s;"></div>
                </div>
            </div>

            <div id="esj-log" style="flex:1;margin:12px;background:#fafafa;border:1px solid #e6e6e6;padding:8px;border-radius:6px;overflow:auto;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;"></div>

            <div style="padding:10px;display:flex;gap:8px;justify-content:flex-end;">
                <button id="esj-cancel" style="padding:8px 12px;background:#d9534f;color:#fff;border:none;border-radius:6px;cursor:pointer;">取消任务</button>
            </div>
        `;

        document.body.appendChild(popup);
        // 使用 popup.querySelector 确保绑定的是当前这个弹窗的头部
        enableDrag(popup, "#esj-header");

        popup.querySelector("#esj-cancel").onclick = () => {
            setAbortFlag(true);
            log("正在取消...已下载的数据会保留在内存中，下次可续传。");
            setTimeout(() => fullCleanup(state.originalTitle), 1000);
        };

        popup.querySelector("#esj-close").onclick = () => {
            setAbortFlag(true);
            fullCleanup(state.originalTitle);
        };

        popup.querySelector("#esj-min").onclick = () => {
            popup.style.display = "none";
            // 获取标题文本用于托盘显示
            const titleEl = popup.querySelector("#esj-title");
            const currentTitle = titleEl ? titleEl.textContent : "";
            const match = currentTitle.match(/（.*?）/);
            const statusText = match ? match[0] : "下载中...";
            
            createMinimizedTray(statusText);
        };

        return popup;
    }

    function createConfirmPopup(onOk, onCancel) {
        fullCleanup(state.originalTitle);

        const cachedCount = state.globalChaptersMap.size;
        let hint = "是否开始抓取该小说全部章节？";
        if (cachedCount > 0) {
            hint = `检测到已有 ${cachedCount} 章缓存，点击确定将跳过已下载章节继续下载。`;
        }

        const pop = document.createElement("div");
        pop.id = "esj-confirm";
        pop.style =
            "position: fixed; top: 30%; left: 50%; transform: translateX(-50%); width: 380px; background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;padding:0;";

        pop.innerHTML = `
            <div id="esj-confirm-header" style="padding:10px;background:#2b9bd7;color:#fff;border-radius:8px 8px 0 0;cursor:move;">确认下载</div>
            <div style="padding:16px;font-size:14px;">${hint}</div>
            <div style="padding:12px;display:flex;justify-content:flex-end;gap:8px;">
                <button id="esj-confirm-cancel" style="padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;">取消</button>
                <button id="esj-confirm-ok" style="padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;">确定</button>
            </div>
        `;

        document.body.appendChild(pop);
        enableDrag(pop, "#esj-confirm-header");

        pop.querySelector("#esj-confirm-cancel").onclick = () => {
            pop.remove();
            if (onCancel) onCancel();
        };
        pop.querySelector("#esj-confirm-ok").onclick = () => {
            pop.remove();
            if (onOk) onOk();
        };
    }

    function showFormatChoice() {
        if (!state.cachedData) {
            alert("暂无数据");
            return;
        }

        const old = document.querySelector("#esj-format");
        if (old) old.remove();

        const box = document.createElement("div");
        box.id = "esj-format";
        box.style = "position:fixed;top:30%;left:50%;transform:translateX(-50%);width:420px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;padding:0;display:flex;flex-direction:column;";

        box.innerHTML = `
            <div id="esj-format-header" style="padding:10px;background:#2b9bd7;color:#fff;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move;">
                <span style="font-weight:bold;">💾 导出选项</span>
                <button id="esj-format-close" style="border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;">✕</button>
            </div>

            <div style="padding:20px;font-size:14px;line-height:1.5;">
                <div>《${state.cachedData.metadata.title}》内容已就绪。</div>
                <div style="color:#666;font-size:12px;margin-top:4px;">共 ${state.cachedData.chapters.length} 章</div>
                ${state.cachedData.metadata.coverBlob ? '<div style="color:green;font-size:12px;margin-top:4px;">✔ 封面已包含在epub文件中</div>' : '<div style="color:red;font-size:12px;margin-top:4px;">✖ 无封面</div>'}
            </div>

            <div style="display:flex;gap:15px;justify-content:center;padding:0 20px 20px 20px;">
                <button id="esj-txt" style="flex:1;padding:10px 0;border:1px solid #ccc;background:#f0f0f0;border-radius:6px;cursor:pointer;font-weight:bold;color:#333;">⬇ TXT 下载</button>
                <button id="esj-epub" style="flex:1;padding:10px 0;border:none;background:#2b9bd7;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;">⬇ EPUB 下载</button>
            </div>
        `;
        document.body.appendChild(box);
        enableDrag(box, "#esj-format-header");

        box.querySelector("#esj-txt").onclick = () => {
            const filename = (state.cachedData.metadata.title || "book") + ".txt";
            const blob = new Blob([state.cachedData.txt], { type: "text/plain;charset=utf-8" });
            triggerDownload(blob, filename);
        };

        box.querySelector("#esj-epub").onclick = async () => {
            // 使用 querySelector 查找当前 box 内的按钮，避免 async 导致的潜在引用问题
            const btn = box.querySelector("#esj-epub");
            if (state.cachedData.epubBlob) {
                const filename = (state.cachedData.metadata.title || "book") + ".epub";
                triggerDownload(state.cachedData.epubBlob, filename);
                return;
            }
            try {
                const oldText = btn.innerText;
                btn.innerText = "生成中...";
                btn.disabled = true;
                btn.style.background = "#7ab8d6";

                const oldTitle = document.title;
                document.title = "[生成 EPUB] " + oldTitle;

                const blob = await buildEpub(state.cachedData.chapters, state.cachedData.metadata);
                state.cachedData.epubBlob = blob;

                const filename = (state.cachedData.metadata.title || "book") + ".epub";
                triggerDownload(blob, filename);

                document.title = oldTitle;
                btn.innerText = oldText;
                btn.disabled = false;
                btn.style.background = "#2b9bd7";
            } catch (e) {
                alert("EPUB 生成失败: " + e.message);
                btn.innerText = "EPUB 失败";
                btn.disabled = false;
            }
        };

        box.querySelector("#esj-format-close").onclick = () => {
            box.remove();
        };
    }

    function triggerDownload(blob, filename) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }

    async function doScrapeAndExport() {
        setAbortFlag(false);
        state.originalTitle = document.title;

        return new Promise((resolveMain) => {
            createConfirmPopup(async () => {
                createDownloadPopup();
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

                // 下载封面附加超时处理
                const fetchCoverWithTimeout = async (url, timeout = 5000) => {
                    const controller = new AbortController();
                    const id = setTimeout(() => controller.abort(), timeout);
                    try {
                        const response = await fetch(url, { 
                            method: "GET", 
                            referrerPolicy: "no-referrer", 
                            credentials: "omit",
                            signal: controller.signal 
                        });
                        clearTimeout(id);
                        if (!response.ok) throw new Error(`Status ${response.status}`);
                        return await response.blob();
                    } catch (e) {
                        clearTimeout(id);
                        throw e;
                    }
                };

                // 封面下载
                const coverTaskPromise = (async () => {
                    try {
                        const imgNode = document.querySelector(".product-gallery img");
                        if (!imgNode) return null;

                        log("启动封面下载...");
                        // 封面获取 15s 超时
                        const blob = await fetchCoverWithTimeout(imgNode.src, 15000);
                        
                        if (blob.size < 1000) {
                            log("⚠ 封面文件过小，已忽略");
                            return null;
                        }

                        let ext = "jpg";
                        if (blob.type.includes("png")) ext = "png";
                        else if (blob.type.includes("jpeg") || blob.type.includes("jpg")) ext = "jpg";
                        
                        log("✔ 封面下载完成");
                        return { blob, ext };
                    } catch (e) {
                        log(`⚠ 封面下载跳过: ${e.message}`);
                        return null;
                    }
                })();

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

                    } catch (e) {
                        log(`❌ 抓取失败：${e}`);
                        // 失败不写入，依靠后续完整性检查补漏
                    } finally {
                        // 随机延迟：100ms ~ 300ms，防止请求过快
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

                // 等待获取封面结果
                const coverResult = await coverTaskPromise; 
                const finalCoverBlob = coverResult ? coverResult.blob : null;
                const finalCoverExt = coverResult ? coverResult.ext : "jpg";    

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
                        coverBlob: finalCoverBlob, 
                        coverExt: finalCoverExt
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

    function injectButton() {
        const btnGroup = document.querySelector(".sp-buttons");
        if (!btnGroup) return;
        if (document.querySelector("#btn-download-book")) return;

        const btn = document.createElement("button");
        btn.id = "btn-download-book";
        btn.className = "btn btn-info m-b-10";
        btn.style.marginLeft = "10px";
        btn.innerHTML = `<i class="icon-download"></i> 全本下载`;

        btn.onclick = () => {
            if (state.cachedData) {
                showFormatChoice();
            } else {
                doScrapeAndExport().catch(e => console.error("主流程异常: " + e.message));
            }
        };
        btnGroup.appendChild(btn);
    }

    const STYLES = `
    /* 遮罩与弹窗基础 */
    #esj-popup {
        position: fixed; top: 18%; left: 50%; transform: translateX(-50%);
        width: 520px; background: #fff; border-radius: 8px;
        border: 1px solid #aaa; box-shadow: 0 0 18px rgba(0,0,0,0.28);
        z-index: 999999; display: flex; flex-direction: column;
        font-family: sans-serif;
    }
    
    /* 头部 */
    #esj-header, #esj-confirm-header, #esj-format-header {
        padding: 10px; background: #2b9bd7; color: #fff;
        display: flex; justify-content: space-between; align-items: center;
        cursor: move; border-radius: 8px 8px 0 0;
    }

    /* 按钮通用 */
    .btn { cursor: pointer; } 
    
    /* 最小化托盘 */
    #esj-min-tray {
        position: fixed; bottom: 20px; left: 20px;
        background: rgba(43, 155, 215, 0.9); color: #fff;
        padding: 10px 15px; border-radius: 25px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        cursor: pointer; z-index: 999999;
        font-size: 14px; font-weight: bold;
        display: flex; align-items: center; gap: 8px;
        transition: transform 0.2s;
    }
    #esj-min-tray:hover { transform: scale(1.05); }

    /* 进度条 */
    #esj-progress { width: 0%; height: 100%; background: #2b9bd7; transition: width .2s; }

    /* 确认弹窗 & 格式弹窗 */
    #esj-confirm, #esj-format {
        position: fixed; top: 30%; left: 50%; transform: translateX(-50%);
        width: 380px; background: #fff; border: 1px solid #aaa;
        border-radius: 8px; box-shadow: 0 0 18px rgba(0,0,0,0.28);
        z-index: 999999; display: flex; flex-direction: column;
    }
    #esj-format { width: 420px; }
`;

    function injectStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        // 尝试插入 head，如果没有 head (document-start 早期) 则插入 documentElement
        (document.head || document.documentElement).appendChild(styleEl);
    }

    // ESJ 前后端没分离，直接从 document-start 开始执行注入，避免评论区加载过慢影响按钮的加载
    (function init() {
        // 注入 CSS 样式
        injectStyles(); 

        // 有页面缓存就直接注入
        if (document.querySelector(".sp-buttons")) {
            injectButton();
        }

        // 此时 body 可能还没生成，所以监听 documentElement 也就是 html 根节点
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        // 检查节点本身是否是目标
                        if (node.classList && node.classList.contains("sp-buttons")) {
                            injectButton();
                            return;
                        }
                        // 检查节点内部是否包含目标
                        if (node.querySelector && node.querySelector(".sp-buttons")) {
                            injectButton();
                            return;
                        }
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        // 兜底定时器，防止 observer 没扫到
        const timer = setInterval(() => {
            if (document.querySelector(".sp-buttons") && !document.querySelector("#btn-download-book")) {
                injectButton();
            }
        }, 1000);

        // 超时自动清除
        setTimeout(() => {
            if (observer) observer.disconnect();
            if (timer) clearInterval(timer);
        }, 30000);

    })();

})();
