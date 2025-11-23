import { get, set, del } from 'idb-keyval';
import { log } from '../utils/index.js';

// 下载缓存配置，24h过期
const CACHE_PREFIX = 'esj_down_';
const CACHE_EXPIRE_TIME = 24 * 60 * 60 * 1000;

// 读取缓存
export async function loadBookCache(bookId) {
    const key = CACHE_PREFIX + bookId;
    try {
        const data = await get(key);
        if (!data) return { size: 0, map: null };

        // 检查过期
        if (Date.now() - data.ts > CACHE_EXPIRE_TIME) {
            log("⚠ 本地缓存已过期，自动清理");
            await del(key);
            return { size: 0, map: null };
        }

        // 恢复 Map
        if (Array.isArray(data.chapters)) {
            const map = new Map(data.chapters);
            log(`💾 已从 IndexedDB 恢复 ${map.size} 章缓存`);
            return { size: map.size, map: map };
        }
    } catch (e) {
        console.error("读取缓存失败", e);
    }
    return { size: 0, map: null };
}

// 保存缓存
export async function saveBookCache(bookId, map) {
    const key = CACHE_PREFIX + bookId;
    const data = {
        ts: Date.now(),
        chapters: Array.from(map.entries())
    };
    try {
        await set(key, data);
    } catch (e) {
        console.error("保存缓存失败", e);
    }
}

// 清理缓存
export async function clearBookCache(bookId) {
    try {
        await del(CACHE_PREFIX + bookId);
        log("🗑️ 任务完成，已清理本地缓存");
    } catch (e) {
        console.error("清理缓存失败", e);
    }
}