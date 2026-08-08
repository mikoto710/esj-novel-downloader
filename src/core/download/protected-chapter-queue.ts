import type { DownloadTask } from "./contracts";

export interface ProtectedChapterWorkItem {
    task: DownloadTask;
    pageHtml: string;
}

export type ProtectedChapterEnqueueResult =
    | { kind: "queued"; item: ProtectedChapterWorkItem }
    | { kind: "duplicate"; item: ProtectedChapterWorkItem }
    | { kind: "skipped"; item: ProtectedChapterWorkItem };

interface QueueWaiter {
    resolve(item: ProtectedChapterWorkItem | null): void;
    signal?: AbortSignal;
    onAbort?: () => void;
}

/**
 * 多个普通 worker 负责生产，单个密码交互消费者负责取出；已取出的章节不会被后来入队的较小索引替换
 */
export class ProtectedChapterQueue {
    private readonly pending: ProtectedChapterWorkItem[] = [];
    private readonly seenIndexes = new Set<number>();
    private readonly waiters: QueueWaiter[] = [];
    private producerClosed = false;
    private skipRemaining = false;

    get pendingCount(): number {
        return this.pending.length;
    }

    get isSkippingRemaining(): boolean {
        return this.skipRemaining;
    }

    /**
     * 按章节索引去重并加入密码交互队列，返回排队、重复或已跳过状态
     */
    enqueue(item: ProtectedChapterWorkItem): ProtectedChapterEnqueueResult {
        if (this.seenIndexes.has(item.task.index)) {
            return { kind: "duplicate", item };
        }
        this.seenIndexes.add(item.task.index);

        if (this.producerClosed || this.skipRemaining) {
            return { kind: "skipped", item };
        }

        const waiter = this.waiters.shift();
        if (waiter) {
            this.detachWaiter(waiter);
            waiter.resolve(item);
        } else {
            this.pending.push(item);
            this.pending.sort((left, right) => left.task.index - right.task.index);
        }
        return { kind: "queued", item };
    }

    /**
     * 按索引顺序取得下一项，生产结束、跳过剩余或取消等待时返回 null
     */
    take(signal?: AbortSignal): Promise<ProtectedChapterWorkItem | null> {
        const item = this.pending.shift();
        if (item) {
            return Promise.resolve(item);
        }
        if (this.producerClosed || this.skipRemaining) {
            return Promise.resolve(null);
        }
        if (signal?.aborted) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            const waiter: QueueWaiter = { resolve, ...(signal ? { signal } : {}) };
            if (signal) {
                waiter.onAbort = () => {
                    const index = this.waiters.indexOf(waiter);
                    if (index >= 0) {
                        this.waiters.splice(index, 1);
                    }
                    resolve(null);
                };
                signal.addEventListener("abort", waiter.onAbort, { once: true });
            }
            this.waiters.push(waiter);
        });
    }

    /**
     * 返回调用时尚未交互的章节供调用方记录跳过；此后 enqueue 的章节直接返回 skipped
     */
    skipAllRemaining(): ProtectedChapterWorkItem[] {
        this.skipRemaining = true;
        const skipped = this.pending.splice(0);
        this.resolveWaiters();
        return skipped;
    }

    /**
     * 标记生产端关闭，调用前已排队的工作项仍可消费，队列耗尽后等待者收到 null
     */
    closeProducer(): void {
        this.producerClosed = true;
        if (this.pending.length === 0) {
            this.resolveWaiters();
        }
    }

    /**
     * 停止生产并返回尚未交互的项目，同时让全部等待者收到 null
     */
    cancel(): ProtectedChapterWorkItem[] {
        this.producerClosed = true;
        const cancelled = this.pending.splice(0);
        this.resolveWaiters();
        return cancelled;
    }

    private resolveWaiters(): void {
        for (const waiter of this.waiters.splice(0)) {
            this.detachWaiter(waiter);
            waiter.resolve(null);
        }
    }

    private detachWaiter(waiter: QueueWaiter): void {
        if (waiter.onAbort) {
            waiter.signal?.removeEventListener("abort", waiter.onAbort);
        }
    }
}
