import { state, setAbortFlag } from '../core/state';
import { fullCleanup, enableDrag, el } from '../utils/dom';
import { log, triggerDownload } from '../utils/index';
import { createMinimizedTray } from './tray';
import { buildEpub } from '../core/epub';
import { CachedData } from '../types';
import { getConcurrency, setConcurrency } from '../core/config';
import { clearAllCaches } from '../core/storage';

/**
 * 锁定/解锁页面上的设置按钮
 * @param locked true=禁用, false=启用
 */
function toggleSettingsLock(locked: boolean) {
    const btns = document.querySelectorAll('.esj-settings-trigger');
    btns.forEach(b => (b as HTMLButtonElement).disabled = locked);
}

/**
 * 创建通用头部
 * @param title 标题
 * @param onClose 关闭回调
 * @param onMinimize (可选) 最小化回调，传了就会显示最小化按钮
 */
function createCommonHeader(title: string, onClose: () => void, onMinimize?: () => void): HTMLElement {
    const btnGroup: HTMLElement[] = [];

    // 1. 最小化按钮 (如果有回调就创建)
    if (onMinimize) {
        const btnMin = el('button', {
            title: '最小化',
            style: 'border:none;background:#81d4fa;color:#000;padding:2px 10px;border-radius:4px;cursor:pointer;font-weight:bold;line-height:1.2;margin-right:5px;',
            onclick: onMinimize
        }, ['_']);
        btnGroup.push(btnMin);
    }

    // 2. 关闭按钮 (红色)
    const btnClose = el('button', {
        title: '关闭',
        style: 'border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;',
        onclick: onClose
    }, ['✕']);
    btnGroup.push(btnClose);

    // 3. 容器
    return el('div', {
        className: 'esj-common-header', // 用于拖拽选择器
        style: 'padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;'
    }, [
        el('span', { style: 'font-weight:bold;' }, [title]),
        el('div', { style: 'display:flex;' }, btnGroup)
    ]);
}

/**
 * 创建下载进度弹窗
 * 包含进度条、日志输出框、取消和最小化按钮
 */
export function createDownloadPopup(): HTMLElement {

    fullCleanup(state.originalTitle);

    toggleSettingsLock(true);

    function onCancel() {
        setAbortFlag(true);
        const btn = document.querySelector("#esj-cancel") as HTMLButtonElement;
        if (btn) {
            btn.disabled = true;
            btn.textContent = "正在保存...";
            btn.style.backgroundColor = "#999";
        }
        log("🛑 正在停止任务，请稍候...");
    }

    function onClose() {
        setAbortFlag(true);
        fullCleanup(state.originalTitle);
    }

    function onMinimize() {
        const popup = document.querySelector("#esj-popup") as HTMLElement;
        if (popup) popup.style.display = "none";

        const headerTitle = popup?.querySelector(".esj-common-header span")?.textContent || "";
        const statusText = headerTitle.replace(/^📘\s*/, "").trim() || "下载中...";

        createMinimizedTray(statusText);
    }

    const header = createCommonHeader('📘 全本下载任务', onClose, onMinimize);

    // 找到里面的 span 加 ID，方便后续更新进度
    const span = header.querySelector('span');
    if (span) span.id = 'esj-title';

    const progressBar = el('div', { id: 'esj-progress', style: 'width:0%;height:100%;background:#2b9bd7;transition:width .2s;' });

    const logBox = el('div', {
        id: 'esj-log',
        style: 'flex:1;margin:12px;background:#fafafa;border:1px solid #e6e6e6;padding:8px;border-radius:6px;overflow:auto;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;'
    });

    const btnCancel = el('button', {
        id: 'esj-cancel',
        style: 'padding:8px 12px;background:#d9534f;color:#fff;border:none;border-radius:6px;cursor:pointer;',
        onclick: onCancel
    }, ['取消任务']);

    const popup = el('div', {
        id: 'esj-popup',
        style: 'position: fixed; top: 18%; left: 50%; transform: translateX(-50%); width: 520px; height: 460px; background: #fff; border-radius: 8px; border: 1px solid #aaa; box-shadow: 0 0 18px rgba(0,0,0,0.28); z-index: 999999; display:flex;flex-direction:column;'
    }, [
        header,
        el('div', { style: 'padding:12px;' }, [
            el('div', { style: 'font-size:13px;margin-bottom:8px;' }, ['进度：']),
            el('div', { style: 'width:100%;height:14px;background:#eee;border-radius:8px;overflow:hidden;' }, [progressBar])
        ]),
        logBox,
        el('div', { style: 'padding:10px;display:flex;gap:8px;justify-content:flex-end;' }, [btnCancel])
    ]);

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
    return popup;
}

/**
 * 创建确认下载的对话框
 * 根据是否有缓存显示不同的提示语
 */
export function createConfirmPopup(onOk: () => void, onCancel?: () => void): void {

    fullCleanup(state.originalTitle);

    toggleSettingsLock(true);

    const cachedCount = state.globalChaptersMap.size;
    const hintText = cachedCount > 0
        ? `检测到已有 ${cachedCount} 章缓存，点击确定将跳过已下载章节继续下载。`
        : "是否开始抓取该小说全部章节？";

    const closeAction = () => {
        document.querySelector("#esj-confirm")?.remove();
        toggleSettingsLock(false);
        if (onCancel) onCancel(); 
    };

    const header = createCommonHeader('✔️ 确认下载', closeAction);
    
    const body = el('div', { style: 'padding:16px;font-size:14px;' }, [hintText]);

    const btnCancel = el('button', {
        id: 'esj-confirm-cancel',
        style: 'padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;',
        onclick: () => {
            popup.remove();
            if (onCancel) {
                toggleSettingsLock(false);
                onCancel();
            };
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
        style: 'position: fixed; top: 30%; left: 50%; transform: translateX(-50%); width: 380px; background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:999999;padding:0;display:flex;flex-direction:column;'
    }, [header, body, footer]);

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
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

    fullCleanup();

    toggleSettingsLock(true);

    const data = state.cachedData as CachedData;

    const closeAction = () => {
        document.querySelector("#esj-format")?.remove();
        toggleSettingsLock(false);
    };

    const header = createCommonHeader('💾 导出选项', closeAction);

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
    enableDrag(popup, ".esj-common-header");

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
 * 创建设置面板弹窗
 */
export function createSettingsPanel(): void {
    fullCleanup();

    // 设置面板打开时，自己就是设置，不需要禁用按钮
    toggleSettingsLock(true);

    const closeAction = () => {
        document.querySelector("#esj-settings")?.remove();
        toggleSettingsLock(false);
    };

    const header = createCommonHeader('⚙️ 脚本设置', closeAction);

    const currentConcurrency = getConcurrency();
    const inputConcurrency = el('input', {
        type: 'number',
        min: 1, max: 10, value: currentConcurrency,
        style: 'width: 60px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; text-align: center;'
    });
    inputConcurrency.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        let val = parseInt(target.value, 10);

        if (isNaN(val))
            return;

        if (val > 10) val = 10;
        if (val < 1) val = 1;

        target.value = val.toString();

        setConcurrency(val);
    };

    let confirmTimer: number;
    let isConfirming = false;
    const btnClear = el('button', {
        className: 'btn btn-danger btn-sm',
        style: 'color: white; min-width: 110px; transition: all 0.2s;',
        onclick: async (e: Event) => {
            const btn = e.target as HTMLButtonElement;

            if (!isConfirming) {
                isConfirming = true;
                btn.textContent = "确定删除?";

                // 3秒后如果不点，自动还原
                confirmTimer = window.setTimeout(() => {
                    isConfirming = false;
                    btn.textContent = "清空缓存";
                }, 3000);
                return;
            }

            clearTimeout(confirmTimer);
            isConfirming = false;

            // 进入 Loading 状态
            btn.disabled = true;
            btn.textContent = "清理中...";

            try {
                await clearAllCaches();

                btn.classList.remove('btn-danger');
                btn.classList.add('btn-success');
                btn.style.backgroundColor = '#28a745';
                btn.textContent = "已清理";
            } catch (err) {
                btn.textContent = "❌ 失败";
                console.error(err);
            } finally {
                setTimeout(() => {
                    btn.disabled = false;
                    btn.classList.remove('btn-success');
                    btn.classList.add('btn-danger');
                    btn.style.backgroundColor = '';
                    btn.textContent = "清空缓存";
                }, 2000);
            }
        }
    }, [' 清空缓存']);

    const popup = el('div', {
        id: 'esj-settings',
        style: 'position:fixed;top:30%;left:50%;transform:translateX(-50%);width:320px;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:999999;display:flex;flex-direction:column;'
    }, [
        header,
        el('div', { style: 'padding: 25px 20px; font-size: 14px;' }, [
            el('div', { style: 'margin-bottom: 20px; display:flex; align-items:center; justify-content:space-between;' }, [
                el('label', { style: 'color: #333;' }, ['下载线程数 (1-10):']),
                inputConcurrency
            ]),
            el('hr', { style: 'margin: 15px 0; border: 0; border-top: 1px solid #eee;' }),
            el('div', { style: 'display:flex; align-items:center; justify-content:space-between;' }, [
                el('label', { style: 'color: #333;' }, ['下载缓存:']),
                btnClear
            ])
        ])
    ]);

    document.body.appendChild(popup);
    enableDrag(popup, ".esj-common-header");
}