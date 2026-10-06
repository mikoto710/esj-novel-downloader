import { state } from "../app/page-session";

/**
 * 使最近导出的 EPUB 派生产物失效，正文继续复用
 */
export function invalidateCachedEpub(): void {
    if (state.cachedData) {
        state.cachedData.epubBlob = null;
        delete state.cachedData.epubTagPageEnabled;
    }
}
