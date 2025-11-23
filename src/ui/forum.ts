import { el } from '../utils/dom';
import { state } from '../core/state';
import { showFormatChoice } from './popups';
import { scrapeForum } from '../scrapers/forum';

/**
 * 在论坛列表页注入 "备份本版" 按钮
 */
export function injectForumButton(): void {
    // 找到包含发帖按钮的 column
    const postBtn = document.querySelector('.forum-list-page .column .btn-success');
    
    if (!postBtn || !postBtn.parentElement) return;
    
    const container = postBtn.parentElement;

    // 防重复
    if (document.querySelector('#btn-download-forum')) return;

    // 创建按钮
    const btn = el('button', {
        id: 'btn-download-forum',
        className: 'btn btn-info',
        style: 'margin-left: 10px; color: white; cursor: pointer;', 
        onclick: () => {
            if (state.cachedData) {
                showFormatChoice();
            } else {
                scrapeForum().catch((e: Error) => console.error("Main Error: " + e.message));
            }
        }
    }, [
        el('i', { className: 'icon-download' }),
        ' 备份本版'
    ]);

    // 插入到发帖按钮后面
    container.appendChild(btn);
}