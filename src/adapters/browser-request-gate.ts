interface PendingRequest<T> {
    kind: "shared" | "exclusive";
    operation: () => Promise<T>;
    signal?: AbortSignal;
    resolve(value: T): void;
    reject(reason: unknown): void;
    onAbort?: () => void;
}

function createAbortError(): DOMException {
    return new DOMException("Request gate cancelled", "AbortError");
}

/**
 * 普通章节请求可以并行；独占授权一旦排队，后续普通请求必须等待，避免覆盖站点的章节会话上下文
 */
export class BrowserRequestGate {
    private readonly queue: PendingRequest<unknown>[] = [];
    private activeShared = 0;
    private activeExclusive = false;

    /**
     * 将普通请求加入共享队列，没有活动或已排队的独占请求时可与其他共享请求并行
     * 排队期间取消会以 AbortError 拒绝，已开始的操作由调用方自行响应 signal
     */
    runShared<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        return this.enqueue("shared", operation, signal);
    }

    /**
     * 将授权请求加入独占队列，开始前等待共享请求完成并阻止后续共享请求越过
     * 排队期间取消会以 AbortError 拒绝，已开始的操作由调用方自行响应 signal
     */
    runExclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        return this.enqueue("exclusive", operation, signal);
    }

    private enqueue<T>(kind: PendingRequest<T>["kind"], operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) {
            return Promise.reject(createAbortError());
        }
        return new Promise<T>((resolve, reject) => {
            const entry: PendingRequest<T> = {
                kind,
                operation,
                resolve,
                reject,
                ...(signal ? { signal } : {})
            };
            if (signal) {
                entry.onAbort = () => {
                    const index = this.queue.indexOf(entry as PendingRequest<unknown>);
                    if (index < 0) {
                        return;
                    }
                    this.queue.splice(index, 1);
                    reject(createAbortError());
                    this.drain();
                };
                signal.addEventListener("abort", entry.onAbort, { once: true });
            }

            if (kind === "shared" && !this.activeExclusive && !this.queue.some((item) => item.kind === "exclusive")) {
                this.startShared(entry as PendingRequest<unknown>);
                return;
            }
            this.queue.push(entry as PendingRequest<unknown>);
            this.drain();
        });
    }

    private detachAbort(entry: PendingRequest<unknown>): void {
        if (entry.onAbort) {
            entry.signal?.removeEventListener("abort", entry.onAbort);
        }
    }

    private startShared(entry: PendingRequest<unknown>): void {
        this.detachAbort(entry);
        if (entry.signal?.aborted) {
            entry.reject(createAbortError());
            this.drain();
            return;
        }
        this.activeShared++;
        entry
            .operation()
            .then(entry.resolve, entry.reject)
            .finally(() => {
                this.activeShared--;
                this.drain();
            });
    }

    private startExclusive(entry: PendingRequest<unknown>): void {
        this.detachAbort(entry);
        if (entry.signal?.aborted) {
            entry.reject(createAbortError());
            this.drain();
            return;
        }
        this.activeExclusive = true;
        entry
            .operation()
            .then(entry.resolve, entry.reject)
            .finally(() => {
                this.activeExclusive = false;
                this.drain();
            });
    }

    private drain(): void {
        if (this.activeExclusive || this.activeShared > 0) {
            return;
        }
        const first = this.queue.shift();
        if (!first) {
            return;
        }
        if (first.kind === "exclusive") {
            this.startExclusive(first);
            return;
        }

        this.startShared(first);
        while (this.queue[0]?.kind === "shared") {
            this.startShared(this.queue.shift()!);
        }
    }
}
