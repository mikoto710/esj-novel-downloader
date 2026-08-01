import { vi } from "vitest";

/**
 * 可由测试代码主动完成或拒绝的 Promise
 */
export interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
    readonly settled: boolean;
}

/**
 * 创建可控的异步结果
 */
export function createDeferred<T>(): Deferred<T> {
    let resolvePromise!: (value: T | PromiseLike<T>) => void;
    let rejectPromise!: (reason?: unknown) => void;
    let settled = false;

    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = (value) => {
            settled = true;
            resolve(value);
        };
        rejectPromise = (reason) => {
            settled = true;
            reject(reason);
        };
    });

    return {
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
        get settled() {
            return settled;
        }
    };
}

/**
 * 测试时钟控制接口
 */
export interface FakeClock {
    now(): number;
    advanceBy(milliseconds: number): Promise<void>;
    runAll(): Promise<void>;
    restore(): void;
}

/**
 * 启用并封装 Vitest 假时钟
 */
export function useFakeClock(now: string | number | Date = "2026-01-01T00:00:00.000Z"): FakeClock {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let restored = false;

    return {
        now: () => Date.now(),
        advanceBy: async (milliseconds) => {
            await vi.advanceTimersByTimeAsync(milliseconds);
        },
        runAll: async () => {
            await vi.runAllTimersAsync();
        },
        restore: () => {
            if (restored) {
                return;
            }
            restored = true;
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    };
}

/**
 * 创建与浏览器请求中止语义一致的异常
 */
export function createAbortError(message = "Aborted"): DOMException {
    return new DOMException(message, "AbortError");
}
