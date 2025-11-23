export const state = {
    abortFlag: false,
    originalTitle: document.title || 'ESJZone',
    cachedData: null,
    globalChaptersMap: new Map()
};

export function setAbortFlag(val) {
    state.abortFlag = val;
}

export function setCachedData(data) {
    state.cachedData = data;
}