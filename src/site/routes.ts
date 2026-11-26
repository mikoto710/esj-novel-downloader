const OFFICIAL_ORIGINS = new Set(["https://www.esjzone.cc", "https://www.esjzone.one"]);
const CHAPTER_PATH = /^\/forum\/(\d+)\/(\d+)\.html$/;

/**
 * 读取两个官方镜像共用的书籍与章节标识
 */
export function parseOfficialChapterUrl(url: string): { origin: string; bookId: string; chapterId: string } | null {
    try {
        const { origin, username, password, pathname } = new URL(url);
        const match = CHAPTER_PATH.exec(pathname);
        if (match && OFFICIAL_ORIGINS.has(origin) && !username && !password) {
            return { origin, bookId: match[1], chapterId: match[2] };
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * 正文请求只接受当前官方镜像的完整章节路径
 */
export function isCurrentSiteChapter(url: string, origin: string): boolean {
    return parseOfficialChapterUrl(url)?.origin === origin;
}
