/**
 * WorkerPool 运行参数
 */
export interface WorkerPoolOptions<T> {
    items: readonly T[];
    concurrency: number;
    isCancellationRequested(): boolean;
    beforeClaim?(): Promise<boolean>;
    onFailure?(error: unknown): void;
    process(item: T, index: number): Promise<void>;
}

/**
 * WorkerPool 执行结果
 */
export interface WorkerPoolResult {
    claimedCount: number;
    completedCount: number;
    cancelled: boolean;
}

/**
 * 并发处理共享任务列表，等待单项返回后再领取，单项异常向调用方抛出
 */
export async function runWorkerPool<T>(options: WorkerPoolOptions<T>): Promise<WorkerPoolResult> {
    const { items, isCancellationRequested, process } = options;
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(options.concurrency) || 1));
    let cursor = 0;
    let completedCount = 0;
    let failed = false;
    let firstFailure: unknown;

    const worker = async () => {
        while (!failed && !isCancellationRequested()) {
            if (options.beforeClaim && !(await options.beforeClaim())) {
                return;
            }
            if (failed || isCancellationRequested()) {
                return;
            }
            const index = cursor;
            if (index >= items.length) {
                return;
            }
            cursor += 1;
            await process(items[index], index);
            completedCount += 1;
        }
    };

    // 固定首错并通知调用方中止在途 I/O；等待所有已领取工作真实结束后再抛出
    await Promise.all(
        Array.from({ length: workerCount }, () =>
            worker().catch((error: unknown) => {
                if (!failed) {
                    failed = true;
                    firstFailure = error;
                    options.onFailure?.(error);
                }
            })
        )
    );
    if (failed) {
        throw firstFailure;
    }
    return {
        claimedCount: cursor,
        completedCount,
        cancelled: isCancellationRequested()
    };
}
