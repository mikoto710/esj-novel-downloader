/**
 * 为持久缓存契约测试取得真实书籍锁
 */
export async function acquireCacheLock(bookId: string) {
    const { acquireBookDownloadLock } = await import("../../src/storage/book-lock");
    const { acquired, lock } = await acquireBookDownloadLock(bookId, "detail");
    if (!acquired) {
        throw new Error(`Unexpected book lock conflict for ${bookId}`);
    }
    return lock;
}
