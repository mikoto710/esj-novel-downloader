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
 * 普通 worker 是多生产者，密码交互是单消费者；当前已取出的章节不受后续较小索引抢占
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
     * 返回当前尚未交互的章节，调用方逐章记录跳过；未来生产的章节由 enqueue 返回 skipped
     */
    skipAllRemaining(): ProtectedChapterWorkItem[] {
        this.skipRemaining = true;
        const skipped = this.pending.splice(0);
        this.resolveWaiters();
        return skipped;
    }

    closeProducer(): void {
        this.producerClosed = true;
        if (this.pending.length === 0) {
            this.resolveWaiters();
        }
    }

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
