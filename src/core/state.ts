import { AppState, CachedData, Chapter } from '../types';

export const state: AppState & { abortController: AbortController | null } = {
    abortFlag: false,
    originalTitle: document.title || 'ESJZone',
    cachedData: null,
    globalChaptersMap: new Map<number, Chapter>(),
    abortController: null
};

export function setAbortFlag(val: boolean): void {
    state.abortFlag = val;
}

export function setCachedData(data: CachedData): void {
    state.cachedData = data;
}

// 重置控制器，用于中止 fetch 请求
export function resetAbortController() {
    state.abortController = new AbortController();
}