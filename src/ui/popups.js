import { state, setAbortFlag } from '../core/state.js';
import { fullCleanup, enableDrag } from '../utils/dom.js';
import { log } from '../utils/index.js';
import { createMinimizedTray } from './tray.js';
import { buildEpub } from '../core/epub.js';

export function createDownloadPopup() {
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
    
    enableDrag(popup, "#esj-header");

    popup.querySelector("#esj-cancel").onclick = () => {
        setAbortFlag(true);
        log("正在取消...已下载的数据会保留在缓存中，下次可续传。");
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

export function createConfirmPopup(onOk, onCancel) {
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

export function showFormatChoice() {
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