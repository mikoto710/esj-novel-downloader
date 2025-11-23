import { AppState, CachedData, Chapter } from '../types';

export const state: AppState = {
    abortFlag: false,
    originalTitle: document.title || 'ESJZone',
    cachedData: null,
    globalChaptersMap: new Map<number, Chapter>() 
};

export function setAbortFlag(val: boolean): void {
    state.abortFlag = val;
}

export function setCachedData(data: CachedData): void {
    state.cachedData = data;
}