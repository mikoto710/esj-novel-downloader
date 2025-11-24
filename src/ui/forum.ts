import { el } from '../utils/dom';
import { state } from '../core/state';
import { showFormatChoice } from './popups';
import { scrapeForum } from '../scrapers/forum';

/**
 * 在论坛版块页注入 "全本下载" 按钮
 */
export function injectForumButton(): void {

    // 防重复注入
    if (document.querySelector('#btn-download-forum')) return;

    // 找到包含发帖按钮的 column
    let container = document.querySelector('.forum-list-page .column');

    // 如果找不到现有容器，手动创建一个容器，并插在表格 (.table-responsive) 前面
    if (!container) {
        const tableEl = document.querySelector('.table-responsive');

        if (tableEl && tableEl.parentElement) {

            container = el('div', { className: 'column' });
            const wrapper = el('div', { className: 'forum-list-page m-b-20' }, [
                container,
                el('div', { className: 'column' })
            ]);

            // 插入到表格节点之前
            tableEl.parentElement.insertBefore(wrapper, tableEl);
        }
    }

    if (!container) return;

    // 创建按钮
    const btn = el('button', {
        id: 'btn-download-forum',
        className: 'btn btn-info',
        // 如果原本没有发帖按钮，就不需要左边距，否则加上 margin-left: 10px
        style: container.children.length > 0 ? 'margin-left: 10px; color: white; cursor: pointer;' : 'color: white; cursor: pointer;',
        onclick: async (e: Event) => {
            const targetBtn = e.target as HTMLButtonElement;

            // 防止弹窗已存在的情景
            const runningPopup = document.querySelector("#esj-popup") as HTMLElement;
            if (runningPopup) {
                // 恢复弹窗显示
                runningPopup.style.display = "flex";
                // 有托盘就顺手删掉
                document.querySelector("#esj-min-tray")?.remove();
                return;
            }

            if (document.querySelector("#esj-confirm") || document.querySelector("#esj-format")) {
                return;
            }
            
            if (state.cachedData) {
                showFormatChoice();
                return;
            }

            if (targetBtn.disabled)
                return;
            targetBtn.disabled = true;
            targetBtn.innerHTML = '<i class="icon-refresh fa-spin"></i> 准备中...';

            if (document.querySelector("#esj-confirm") || document.querySelector("#esj-format")) {
                return;
            }

            try {
                await scrapeForum();
            } catch (err: any) {
                console.error("Main Error: " + err.message);
            } finally {
                targetBtn.disabled = false;
                targetBtn.innerHTML = '';
                targetBtn.appendChild(el('i', { className: '' }));
                targetBtn.appendChild(document.createTextNode(' 全本下载'));
            }
        }
    }, [
        el('i', { className: '' }),
        ' 全本下载'
    ]);

    container.appendChild(btn);
}