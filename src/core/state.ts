import { AppState, CachedData, Chapter } from '../types';

export const state: AppState & { abortController: AbortController | null } = {
    abortFlag: false,
    originalTitle: document.title || 'ESJZone',
    cachedData: null,
    globalChaptersMap: new Map<number, Chapter>(),
    abortController: null
};

/**
 * 设置中止状态
 */
export function setAbortFlag(val: boolean): void {
    state.abortFlag = val;
}

/**
 * 缓存数据到全局状态
 */
export function setCachedData(data: CachedData): void {
    state.cachedData = data;
}

/**
 * 重置控制器，用于中止 fetch 请求
 */
export function resetAbortController() {
    state.abortController = new AbortController();
}

/**
 * 重置所有全局状态
 */ 
export function resetGlobalState(): void {
    state.cachedData = null;
    state.globalChaptersMap.clear();
    // state.abortFlag = false;
    console.log('内存状态已重置');
}