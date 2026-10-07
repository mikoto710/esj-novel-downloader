import type { DownloadCancellationPort } from "./contracts";
import { isCancellationError } from "./errors";

interface PendingDecision<T> {
    operation: () => Promise<T>;
    signal?: AbortSignal;
    resolve(value: T): void;
    reject(reason: unknown): void;
    onAbort?: () => void;
}

function createAbortError(): Error {
    return new DOMException("User decision cancelled", "AbortError");
}

/**
 * 同一下载任务的阻塞式用户决策必须串行，避免密码、映射字体和缺章弹窗互相覆盖
 */
export class UserDecisionGate {
    private readonly queue: PendingDecision<unknown>[] = [];
    private active = false;

    /**
     * 按调用顺序串行执行用户决策，排队取消时以 AbortError 拒绝
     */
    run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        // 操作开始后由操作自身响应 signal，队列只负责尚未开始的等待
        if (signal?.aborted) {
            return Promise.reject(createAbortError());
        }
        return new Promise<T>((resolve, reject) => {
            const entry: PendingDecision<T> = { operation, resolve, reject, ...(signal ? { signal } : {}) };
            if (signal) {
                entry.onAbort = () => {
                    const index = this.queue.indexOf(entry as PendingDecision<unknown>);
                    if (index < 0) {
                        return;
                    }
                    this.queue.splice(index, 1);
                    reject(createAbortError());
                };
                signal.addEventListener("abort", entry.onAbort, { once: true });
            }
            this.queue.push(entry as PendingDecision<unknown>);
            this.drain();
        });
    }

    private drain(): void {
        if (this.active) {
            return;
        }
        const entry = this.queue.shift();
        if (!entry) {
            return;
        }
        if (entry.onAbort) {
            entry.signal?.removeEventListener("abort", entry.onAbort);
        }
        if (entry.signal?.aborted) {
            entry.reject(createAbortError());
            this.drain();
            return;
        }

        this.active = true;
        entry
            .operation()
            .then(entry.resolve, entry.reject)
            .finally(() => {
                this.active = false;
                this.drain();
            });
    }
}

/**
 * 已请求取消或操作以取消错误结束时返回约定值，其余错误向调用方抛出
 */
export async function runUserDecision<T>(
    gate: UserDecisionGate,
    cancellation: DownloadCancellationPort,
    operation: () => Promise<T>,
    cancelled: T
): Promise<T> {
    try {
        return await gate.run(operation, cancellation.signal);
    } catch (error) {
        if (cancellation.isCancellationRequested() || isCancellationError(error)) {
            return cancelled;
        }
        throw error;
    }
}
