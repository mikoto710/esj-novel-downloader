import { scrapeDetail } from '../scrapers/detail';
import { createDownloadButton, createSettingButton } from './components';

/**
 * 向小说详情页注入 "全本下载" 按钮
 */
export function injectDetailButton(): void {
    const btnGroup = document.querySelector(".sp-buttons");
    if (!btnGroup) return;

    // 防止重复注入
    if (document.querySelector("#btn-download-book")) return;

    const downloadBtn = createDownloadButton(
        'btn-download-book',
        '全本下载',
        scrapeDetail,
        'm-b-10'
    );

    const settingBtn = createSettingButton('m-b-10');

    btnGroup.appendChild(downloadBtn);

    btnGroup.appendChild(settingBtn);
}