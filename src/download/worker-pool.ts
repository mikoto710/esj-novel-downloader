/**
 * WorkerPool 运行参数
 */
export interface WorkerPoolOptions<T> {
    items: readonly T[];
    concurrency: number;
    isCancellationRequested(): boolean;
    beforeClaim?(): Promise<boolean>;
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

    const worker = async () => {
        while (!isCancellationRequested()) {
            if (options.beforeClaim && !(await options.beforeClaim())) {
                return;
            }
            if (isCancellationRequested()) {
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

    // 单个 worker 拒绝不会自动停止其他 worker，调用方仍须通过取消状态终止它们
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return {
        claimedCount: cursor,
        completedCount,
        cancelled: isCancellationRequested()
    };
}
