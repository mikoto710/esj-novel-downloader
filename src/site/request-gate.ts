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
 * 共享章节请求可以并行；独占授权排队后，新提交的共享请求必须等待，避免覆盖站点的章节会话上下文
 */
export class RequestGate {
    private readonly queue: PendingRequest<unknown>[] = [];
    private activeShared = 0;
    private activeExclusive = false;

    /**
     * 排队共享请求，已有独占请求等待或执行时禁止新共享请求越过
     */
    runShared<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        return this.enqueue("shared", operation, signal);
    }

    /**
     * 排队独占授权，等待在途共享请求结束并阻止后续共享请求越过
     */
    runExclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        return this.enqueue("exclusive", operation, signal);
    }

    private enqueue<T>(kind: PendingRequest<T>["kind"], operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        // 排队取消会拒绝；开始执行后由操作自身响应同一个 signal
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
