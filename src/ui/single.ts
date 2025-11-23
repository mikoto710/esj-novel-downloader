import { el } from '../utils/dom';
import { downloadCurrentPage } from '../scrapers/single';

/**
 * 在单页注入 "下载本章" 按钮
 */
export function injectSinglePageButton(): void {
    // 定位中间的 column
    const viewAllBtn = document.querySelector('.entry-navigation .view-all');
    
    if (!viewAllBtn || !viewAllBtn.parentElement) return;
    
    const container = viewAllBtn.parentElement;

    // 防重复
    if (document.querySelector('#btn-download-single')) return;

    // 创建按钮
    const btn = el('a', {
        id: 'btn-download-single',
        className: 'btn btn-outline-secondary',
        style: 'margin-left: 5px; cursor: pointer;', 
        title: '下载本章 (TXT)',
        onclick: (e: Event) => {
            e.preventDefault();
            downloadCurrentPage();
        }
    }, [
        el('i', { className: 'icon-download' }) 
    ]);

    // 插入到回整合按钮后面
    container.appendChild(btn);
}