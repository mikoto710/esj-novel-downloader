import { createStore, del, get } from "idb-keyval";
import type { ChapterSummary } from "../export/snapshot";
import type { DownloadFormat } from "../export/filename";
import type { SourcePageType } from "../content/model";
import type { StoredDownloadSelectionSummary } from "../download/plan";

/**
 * 已触发文件下载的导出历史，不表示浏览器已经保存文件
 */
export interface DownloadHistoryItem {
    id: string;
    bookId?: string;
    bookName: string;
    author: string;
    format: DownloadFormat;
    sourcePageType: Extract<SourcePageType, "detail" | "forum" | "single">;
    chapterSummary?: ChapterSummary;
    selection?: StoredDownloadSelectionSummary;
    // 兼容旧版下载记录，新记录改用 chapterSummary
    chapterInfo?: string;
    imageInfo?: {
        enabled: boolean;
        successCount: number;
        failureCount: number;
    };
    // 兼容旧版下载记录，新记录改用 imageInfo
    imageEnabled?: boolean;
    pageUrl: string;
    exportedAt: number;
}

const HISTORY_KEY = "esj_down_history";
const HISTORY_LIMIT = 100;
// 历史记录沿用 idb-keyval 的默认数据库和对象仓库
const historyStore = createStore("keyval-store", "keyval");

interface StoredHistory {
    version: 1;
    items: DownloadHistoryItem[];
}

function historyItems(data: StoredHistory | undefined): DownloadHistoryItem[] {
    return Array.isArray(data?.items) ? data.items : [];
}

function updateHistory(change: (items: DownloadHistoryItem[]) => DownloadHistoryItem[]): Promise<void> {
    return historyStore(
        "readwrite",
        (store) =>
            new Promise<void>((resolve, reject) => {
                const transaction = store.transaction;
                const request: IDBRequest<StoredHistory | undefined> = store.get(HISTORY_KEY);
                // 读写请求失败会中止事务，只有提交后才确认历史变更
                transaction.oncomplete = () => resolve();
                transaction.onabort = () =>
                    reject(transaction.error ?? new DOMException("下载记录事务已中止", "AbortError"));
                request.onsuccess = () => {
                    try {
                        const items = change(historyItems(request.result));
                        store.put({ version: 1, items } satisfies StoredHistory, HISTORY_KEY);
                    } catch (error) {
                        transaction.abort();
                        reject(error);
                    }
                };
            })
    );
}

/**
 * 按导出时间倒序列出下载记录
 */
export async function listDownloadHistory(): Promise<DownloadHistoryItem[]> {
    let data: StoredHistory | undefined;
    try {
        data = await get<StoredHistory>(HISTORY_KEY, historyStore);
    } catch (error) {
        console.error("读取下载记录失败", error);
        return [];
    }
    return historyItems(data).sort((a, b) => b.exportedAt - a.exportedAt);
}

/**
 * 保存下载记录并裁剪到数量上限
 */
export async function addDownloadHistory(item: Omit<DownloadHistoryItem, "id" | "exportedAt">): Promise<void> {
    try {
        await updateHistory((items) => {
            items.unshift({
                ...item,
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                exportedAt: Date.now()
            });
            return items.sort((a, b) => b.exportedAt - a.exportedAt).slice(0, HISTORY_LIMIT);
        });
    } catch (error) {
        console.error("保存下载记录失败", error);
    }
}

/**
 * 删除指定下载记录
 */
export async function removeDownloadHistory(id: string): Promise<void> {
    await updateHistory((items) => items.filter((item) => item.id !== id));
}

/**
 * 清空全部下载记录
 */
export async function clearDownloadHistory(): Promise<void> {
    await del(HISTORY_KEY, historyStore);
}

/**
 * 最多保留的下载记录数量
 */
export const DOWNLOAD_HISTORY_LIMIT = HISTORY_LIMIT;
