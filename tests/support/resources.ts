/**
 * 删除测试数据库，并在连接未响应版本变更时报告泄漏
 */
export function deleteTestDatabase(database: string, factory: IDBFactory = indexedDB): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = factory.deleteDatabase(database);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Test database connection was not released: ${database}`));
    });
}
