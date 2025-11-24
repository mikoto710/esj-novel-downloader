import { state, setAbortFlag } from '../core/state';
import { fullCleanup, enableDrag, el } from '../utils/dom'; // 引入 el 函数
import { log } from '../utils/index';
import { createMinimizedTray } from './tray';
import { buildEpub } from '../core/epub';
import { CachedData } from '../types';

/**
 * 创建下载进度弹窗
 * 包含进度条、日志输出框、取消和最小化按钮
 */
export function createDownloadPopup(): HTMLElement {
    // 清理旧弹窗
    fullCleanup(state.originalTitle);

    // DOM 构建
    // 1. Header
    const titleEl = el('span', { id: 'esj-title' }, ['📘 全本下载任务']);
    const btnMin = el('button', {
        id: 'esj-min',
        style: 'border:none;background:#81d4fa;color:#000;padding:2px 10px;border-radius:4px;cursor:pointer;font-weight:bold;line-height:1.2;',
        onclick: onMinimize
    }, ['_']);
    const btnClose = el('button', {
        id: 'esj-close',
        style: 'border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;',
        onclick: onClose
    }, ['✕']);

    const header = el('div', {
        id: 'esj-header',
        style: 'padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;'
    }, [
        titleEl,
        el('div', { style: 'display:flex;gap:8px;' }, [btnMin, btnClose])
    ]);

    // 2. 进度条区域
    const progressBar = el('div', {
        id: 'esj-progress',
        style: 'width:0%;height:100%;background:#2b9bd7;transition:width .2s;'
    });

    const progressSection = el('div', { style: 'padding:12px;' }, [
        el('div', { style: 'font-size:13px;margin-bottom:8px;' }, ['进度：']),
        el('div', { style: 'width:100%;height:14px;background:#eee;border-radius:8px;overflow:hidden;' }, [progressBar])
    ]);

    // 3. 日志区域
    const logBox = el('div', {
        id: 'esj-log',
        style: 'flex:1;margin:12px;background:#fafafa;border:1px solid #e6e6e6;padding:8px;border-radius:6px;overflow:auto;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;'
    });

    // 4. 底部按钮
    const btnCancel = el('button', {
        id: 'esj-cancel',
        style: 'padding:8px 12px;background:#d9534f;color:#fff;border:none;border-radius:6px;cursor:pointer;',
        onclick: onCancel
    }, ['取消任务']);

    const footer = el('div', {
        style: 'padding:10px;display:flex;gap:8px;justify-content:flex-end;'
    }, [btnCancel]);

    // 5. 主容器
    const popup = el('div', {
        id: 'esj-popup',
        style: 'position: fixed; top: 18%; left: 50%; transform: translateX(-50%); width: 520px; height: 460px; background: #fff; border-radius: 8px; border: 1px solid #aaa; box-shadow: 0 0 18px rgba(0,0,0,0.28); z-index: 999999; display:flex;flex-direction:column;'
    }, [header, progressSection, logBox, footer]);

    // 挂载与拖拽
    document.body.appendChild(popup);
    enableDrag(popup, "#esj-header");

    function onCancel() {
        setAbortFlag(true);
        btnCancel.disabled = true;
        btnCancel.textContent = "正在保存...";
        btnCancel.style.backgroundColor = "#999";
        log("🛑 正在停止任务，请稍候...");
    }

    function onClose() {
        setAbortFlag(true);
        fullCleanup(state.originalTitle);
    }

    function onMinimize() {
        popup.style.display = "none";
        const currentTitle = titleEl.textContent || "";
        const statusText = currentTitle.replace(/^📘\s*/,"").trim() || "下载中...";
        createMinimizedTray(statusText);
    }

    return popup;
}

/**s
 * 创建确认下载的对话框
 * 根据是否有缓存显示不同的提示语
 */
export function createConfirmPopup(onOk: () => void, onCancel?: () => void): void {
    fullCleanup(state.originalTitle);

    const cachedCount = state.globalChaptersMap.size;
    const hintText = cachedCount > 0
        ? `检测到已有 ${cachedCount} 章缓存，点击确定将跳过已下载章节继续下载。`
        : "是否开始抓取该小说全部章节？";

    const header = el('div', {
        id: 'esj-confirm-header',
        style: 'padding:10px;background:#2b9bd7;color:#fff;border-radius:8px 8px 0 0;cursor:move;'
    }, ['确认下载']);

    const body = el('div', { style: 'padding:16px;font-size:14px;' }, [hintText]);

    const btnCancel = el('button', {
        id: 'esj-confirm-cancel',
        style: 'padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;',
        onclick: () => {
            popup.remove();
            if (onCancel) onCancel();
        }
    }, ['取消']);

    const btnOk = el('button', {
        id: 'esj-confirm-ok',
        style: 'padding:8px 12px;background:#2b9bd7;color:#fff;border:none;border-radius:6px;cursor:pointer;',
        onclick: () => {
            popup.remove();
            onOk();
        }
    }, ['确定']);

    const footer = el('div', {
        style: 'padding:12px;display:flex;justify-content:flex-end;gap:8px;'
    }, [btnCancel, btnOk]);

    const popup = el('div', {
        id: 'esj-confirm',
        style: 'position: fixed; top: 30%; left: 50%; transform: translateX(-50%); width: 380px; background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;padding:0;'
    }, [header, body, footer]);

    document.body.appendChild(popup);
    enableDrag(popup, "#esj-confirm-header");
}

/**
 * 显示格式选择弹窗 (TXT / EPUB)
 * 在所有章节抓取完成后调用
 */
export function showFormatChoice(): void {
    if (!state.cachedData) {
        alert("暂无数据");
        return;
    }

    const old = document.querySelector("#esj-format");
    if (old) old.remove();

    const data = state.cachedData as CachedData;

    const btnClose = el('button', {
        id: 'esj-format-close',
        style: 'border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;',
        onclick: () => popup.remove()
    }, ['✕']);

    const header = el('div', {
        id: 'esj-format-header',
        style: 'padding:10px;background:#2b9bd7;color:#fff;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move;'
    }, [
        el('span', { style: 'font-weight:bold;' }, ['💾 导出选项']),
        btnClose
    ]);

    const coverStatus = data.metadata.coverBlob
        ? el('div', { style: 'color:green;font-size:12px;margin-top:4px;' }, ['✔ 封面已包含在 epub 文件中'])
        : el('div', { style: 'color:red;font-size:12px;margin-top:4px;' }, ['✖ 无封面']);

    const infoBody = el('div', { style: 'padding:20px;font-size:14px;line-height:1.5;' }, [
        el('div', {}, [`《${data.metadata.title}》内容已就绪。`]),
        el('div', { style: 'color:#666;font-size:12px;margin-top:4px;' }, [`共 ${data.chapters.length} 章`]),
        coverStatus
    ]);

    const btnTxt = el('button', {
        id: 'esj-txt',
        style: 'flex:1;padding:10px 0;border:1px solid #ccc;background:#f0f0f0;border-radius:6px;cursor:pointer;font-weight:bold;color:#333;',
        onclick: () => {
            const filename = (data.metadata.title || "book") + ".txt";
            const blob = new Blob([data.txt], { type: "text/plain;charset=utf-8" });
            triggerDownload(blob, filename);
        }
    }, ['⬇ TXT 下载']);

    const btnEpub = el('button', {
        id: 'esj-epub',
        style: 'flex:1;padding:10px 0;border:none;background:#2b9bd7;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold;',
        onclick: async () => handleEpubDownload(btnEpub)
    }, ['⬇ EPUB 下载']);

    const footer = el('div', {
        style: 'display:flex;gap:15px;justify-content:center;padding:0 20px 20px 20px;'
    }, [btnTxt, btnEpub]);

    const popup = el('div', {
        id: 'esj-format',
        style: 'position:fixed;top:30%;left:50%;transform:translateX(-50%);width:420px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:999999;padding:0;display:flex;flex-direction:column;'
    }, [header, infoBody, footer]);

    document.body.appendChild(popup);
    enableDrag(popup, "#esj-format-header");

    // 下载 EPUB
    async function handleEpubDownload(btn: HTMLButtonElement) {
        const currentData = state.cachedData as CachedData;

        // 如果已经生成过，直接下载缓存的 blob
        if (currentData.epubBlob) {
            const filename = (currentData.metadata.title || "book") + ".epub";
            triggerDownload(currentData.epubBlob, filename);
            return;
        }

        try {
            const oldText = btn.innerText;
            btn.innerText = "生成中...";
            btn.disabled = true;
            btn.style.background = "#7ab8d6";

            const oldTitle = document.title;
            document.title = "[生成 EPUB] " + oldTitle;

            const blob = await buildEpub(currentData.chapters, currentData.metadata);
            currentData.epubBlob = blob;

            const filename = (currentData.metadata.title || "book") + ".epub";
            triggerDownload(blob, filename);

            document.title = oldTitle;
            btn.innerText = oldText;
            btn.disabled = false;
            btn.style.background = "#2b9bd7";
        } catch (e: any) {
            alert("EPUB 生成失败: " + e.message);
            btn.innerText = "EPUB 失败";
            btn.disabled = false;
        }
    }
}

/**
 * 触发浏览器下载逻辑
 */
function triggerDownload(blob: Blob, filename: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}