import { el } from '../utils/dom';
import { state } from '../core/state';
import { showFormatChoice } from './popups';
import { scrapeForum } from '../scrapers/forum';

/**
 * 在论坛列表页注入 "全本下载" 按钮
 */
export function injectForumButton(): void {
    // 找到包含发帖按钮的 column
    let container = document.querySelector('.forum-list-page .column');

    // 如果找不到现有容器，手动创建一个容器，并插在表格 (.table-responsive) 前面
    if (!container) {
        const tableEl = document.querySelector('.table-responsive'); // 帖子列表表格
        
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

    // 防重复
    if (document.querySelector('#btn-download-forum')) return;

    // 创建按钮
    const btn = el('button', {
        id: 'btn-download-forum',
        className: 'btn btn-info',
        // 如果原本没有发帖按钮，就不需要左边距，否则加上 margin-left: 10px
        style: container.children.length > 0 ? 'margin-left: 10px; color: white; cursor: pointer;' : 'color: white; cursor: pointer;', 
        onclick: () => {
            if (state.cachedData) {
                showFormatChoice();
            } else {
                scrapeForum().catch((e: Error) => console.error("Main Error: " + e.message));
            }
        }
    }, [
        el('i', { className: '' }),
        ' 全本下载'
    ]);
    
    container.appendChild(btn);
}