import { del, get, set } from "idb-keyval";
import { DownloadHistoryItem } from "../types";

const HISTORY_KEY = "esj_down_history";
const HISTORY_LIMIT = 100;

interface StoredHistory {
    version: 1;
    items: DownloadHistoryItem[];
}

async function readHistory(): Promise<DownloadHistoryItem[]> {
    try {
        const data = await get<StoredHistory>(HISTORY_KEY);
        return Array.isArray(data?.items) ? data.items : [];
    } catch (error) {
        console.error("读取下载记录失败", error);
        return [];
    }
}

async function writeHistory(items: DownloadHistoryItem[]): Promise<void> {
    await set(HISTORY_KEY, { version: 1, items } satisfies StoredHistory);
}

export async function listDownloadHistory(): Promise<DownloadHistoryItem[]> {
    return (await readHistory()).sort((a, b) => b.exportedAt - a.exportedAt);
}

export async function addDownloadHistory(item: Omit<DownloadHistoryItem, "id" | "exportedAt">): Promise<void> {
    try {
        const items = await readHistory();
        items.unshift({
            ...item,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            exportedAt: Date.now()
        });
        await writeHistory(items.sort((a, b) => b.exportedAt - a.exportedAt).slice(0, HISTORY_LIMIT));
    } catch (error) {
        console.error("保存下载记录失败", error);
    }
}

export async function removeDownloadHistory(id: string): Promise<void> {
    const items = await readHistory();
    await writeHistory(items.filter((item) => item.id !== id));
}

export async function clearDownloadHistory(): Promise<void> {
    await del(HISTORY_KEY);
}

export const DOWNLOAD_HISTORY_LIMIT = HISTORY_LIMIT;
