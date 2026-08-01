/**
 * WorkerPool 运行参数
 */
export interface WorkerPoolOptions<T> {
    items: readonly T[];
    concurrency: number;
    isCancellationRequested(): boolean;
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
 * 使用共享游标并发处理任务
 * 每个 worker 必须等待当前任务及其下游写入完成后才领取下一项，从而将 backpressure 传回任务队列
 */
export async function runWorkerPool<T>(options: WorkerPoolOptions<T>): Promise<WorkerPoolResult> {
    const { items, isCancellationRequested, process } = options;
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(options.concurrency) || 1));
    let cursor = 0;
    let completedCount = 0;

    const worker = async () => {
        while (!isCancellationRequested()) {
            const index = cursor;
            if (index >= items.length) {
                return;
            }
            cursor += 1;
            await process(items[index], index);
            completedCount += 1;
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return {
        claimedCount: cursor,
        completedCount,
        cancelled: isCancellationRequested()
    };
}
