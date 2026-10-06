/**
 * 异步操作的重试策略
 */
export interface RetryPolicy {
    maxAttempts: number;
    getDelayMs(failedAttempt: number): number;
}

/**
 * 章节网络请求的默认重试策略
 */
export const DEFAULT_CHAPTER_RETRY_POLICY: Readonly<RetryPolicy> = Object.freeze({
    maxAttempts: 3,
    getDelayMs: (failedAttempt: number) => 300 * failedAttempt
});

/**
 * 重试执行结果
 */
export type RetryResult<T> =
    | { status: "success"; value: T; attempts: number }
    | { status: "failed"; error: unknown; attempts: number }
    | { status: "cancelled"; attempts: number };

interface RetryOperationOptions<T> {
    policy: RetryPolicy;
    operation(attempt: number): Promise<T>;
    sleep(delayMs: number): Promise<void>;
    isCancellationRequested(): boolean;
    isCancellationError?(error: unknown): boolean;
}

/**
 * 按可注入策略执行异步重试
 */
export async function runWithRetry<T>(options: RetryOperationOptions<T>): Promise<RetryResult<T>> {
    const maxAttempts = Math.max(1, Math.floor(options.policy.maxAttempts) || 1);
    let lastError: unknown = new Error("重试操作未执行");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (options.isCancellationRequested()) {
            return { status: "cancelled", attempts: attempt - 1 };
        }
        try {
            return { status: "success", value: await options.operation(attempt), attempts: attempt };
        } catch (error) {
            lastError = error;
            if (options.isCancellationRequested() || options.isCancellationError?.(error)) {
                return { status: "cancelled", attempts: attempt };
            }
            if (attempt < maxAttempts) {
                await options.sleep(options.policy.getDelayMs(attempt));
            }
        }
    }

    return { status: "failed", error: lastError, attempts: maxAttempts };
}
