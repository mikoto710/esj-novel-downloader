import { el } from '../utils/dom';
import { state } from '../core/state';
import { showFormatChoice, createSettingsPanel } from './popups';

/**
 * 创建通用的设置按钮
 * @param customClass 额外的 CSS 类 (如 "m-b-10")
 */
export function createSettingButton(customClass: string = ''): HTMLElement {
    return el('button', {
        className: `btn btn-primary esj-settings-trigger ${customClass}`,
        style: 'color: white; cursor: pointer;',
        onclick: (e: Event) => {
            e.preventDefault();
            // 如果被禁用，直接返回
            if ((e.target as HTMLButtonElement).disabled) return;
            // 互斥锁：有任务运行时禁止
            if (document.querySelector("#esj-popup") || document.querySelector("#esj-min-tray")) {
                return;
            }
            createSettingsPanel();
        }
    }, [
        el('i', { className: 'icon-settings' }),
    ]);
}

/**
 * 创建通用的下载按钮
 * @param id DOM ID
 * @param text 按钮显示的文字
 * @param scrapeFn 点击后执行的抓取函数 (async)
 * @param customClass 额外的 CSS 类 (如 "m-b-10")
 */
export function createDownloadButton(
    id: string,
    text : string = "全本下载",
    scrapeFn: () => Promise<void>,
    customClass: string = ''
): HTMLElement {
    
    const btn = el('button', {
        id: id,
        className: `btn btn-info esj-download-trigger ${customClass}`,
        style: 'color: white; cursor: pointer;',
        onclick: async () => {
            
            // 防止弹窗已存在的情景
            const runningPopup = document.querySelector("#esj-popup") as HTMLElement;
            if (runningPopup) {
                // 恢复弹窗显示
                runningPopup.style.display = "flex";
                document.querySelector("#esj-min-tray")?.remove();
                return;
            }

            // 检查是否处于其他弹窗状态
            if (document.querySelector("#esj-confirm") || document.querySelector("#esj-format")) {
                return;
            }

            // 如果有缓存，直接显示导出窗口，不进入 loading
            if (state.cachedData) {
                showFormatChoice();
                return;
            }

            // 执行抓取任务，进入 loading
            if (btn.disabled) return;
            
            // 保存原始 HTML 以便恢复
            const originalHtml = btn.innerHTML;
            
            btn.disabled = true;
            btn.innerHTML = '<i class="icon-refresh fa-spin"></i> 准备中...';

            try {
                await scrapeFn();
            } catch (err: any) {
                console.error("Scrape Error: " + err.message);
            } finally {
                // btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    }, [
        el('i', { className: 'icon-download' }),
        ' ' + text
    ]);

    return btn;
}