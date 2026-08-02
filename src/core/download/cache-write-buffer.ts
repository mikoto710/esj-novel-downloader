import type { Chapter, DownloadCancellationMode } from "../../types";

/**
 * 普通取消等待缓存落盘的最长时间
 */
export const CANCELLATION_CACHE_FLUSH_TIMEOUT_MS = 5_000;

/**
 * 取消收尾时的缓存处理结果
 */
export type CancellationCacheFlushResult = "saved" | "failed" | "timed-out" | "discarded";

/**
 * 增量缓存写入触发策略
 */
export interface CacheWritePolicy {
    maxChapterCount: number;
    maxBytes: number;
    maxDelayMs: number;
}

/**
 * 默认增量缓存写入策略
 */
export const DEFAULT_CACHE_WRITE_POLICY: Readonly<CacheWritePolicy> = Object.freeze({
    maxChapterCount: 25,
    maxBytes: 4 * 1024 * 1024,
    maxDelayMs: 3_000
});

interface CacheWriteBufferOptions {
    policy?: CacheWritePolicy;
    write(entries: ReadonlyMap<number, Chapter>, signal: AbortSignal): Promise<boolean>;
    schedule(delayMs: number, callback: () => void): () => void;
    subscribeCancellation?(listener: (mode: DownloadCancellationMode) => void): () => void;
    cancellationTimeoutMs?: number;
    estimateBytes?(chapter: Chapter): number;
}

interface ActiveCacheWrite {
    controller: AbortController;
    abort(): void;
}

/**
 * 合并并串行写入下载过程中发生变化的章节
 */
export class ChapterCacheWriteBuffer {
    private readonly policy: CacheWritePolicy;
    private readonly write: CacheWriteBufferOptions["write"];
    private readonly schedule: CacheWriteBufferOptions["schedule"];
    private readonly cancellationTimeoutMs: number;
    private readonly estimateBytes: NonNullable<CacheWriteBufferOptions["estimateBytes"]>;
    private pending = new Map<number, Chapter>();
    private pendingBytes = 0;
    private cancelScheduledFlush: (() => void) | null = null;
    private cancelCancellationDeadline: (() => void) | null = null;
    private unsubscribeCancellation: (() => void) | null = null;
    private activeWrite: ActiveCacheWrite | null = null;
    private writeChain = Promise.resolve(true);
    private rejected = false;
    private cancellationTimedOut = false;
    private discarded = false;

    constructor(options: CacheWriteBufferOptions) {
        this.policy = options.policy || DEFAULT_CACHE_WRITE_POLICY;
        this.write = options.write;
        this.schedule = options.schedule;
        this.cancellationTimeoutMs = options.cancellationTimeoutMs ?? CANCELLATION_CACHE_FLUSH_TIMEOUT_MS;
        this.estimateBytes = options.estimateBytes || estimateChapterCacheBytes;
        this.unsubscribeCancellation =
            options.subscribeCancellation?.((mode) => this.requestCancellation(mode)) || null;
    }

    get dirtyChapterCount(): number {
        return this.pending.size;
    }

    get dirtyBytes(): number {
        return this.pendingBytes;
    }

    async add(index: number, chapter: Chapter): Promise<boolean> {
        if (this.rejected || this.discarded) {
            return false;
        }

        const previous = this.pending.get(index);
        if (previous) {
            this.pendingBytes -= this.estimateBytes(previous);
        }
        this.pending.set(index, chapter);
        this.pendingBytes += this.estimateBytes(chapter);
        this.ensureScheduledFlush();

        if (this.pending.size >= this.policy.maxChapterCount || this.pendingBytes >= this.policy.maxBytes) {
            return this.flush();
        }
        return true;
    }

    async flush(): Promise<boolean> {
        if (this.discarded || this.cancellationTimedOut) {
            return false;
        }
        if (this.pending.size === 0) {
            return this.writeChain;
        }

        this.cancelTimer();
        const batch = this.pending;
        this.pending = new Map();
        this.pendingBytes = 0;

        const previousWrite = this.writeChain;
        const currentWrite = previousWrite.then(async (previousSaved) => {
            if (!previousSaved || this.rejected || this.discarded || this.cancellationTimedOut) {
                return false;
            }

            const controller = new AbortController();
            let resolveAborted: (saved: boolean) => void = () => undefined;
            const aborted = new Promise<boolean>((resolve) => {
                resolveAborted = resolve;
            });
            let writeSettled = false;
            const activeWrite: ActiveCacheWrite = {
                controller,
                abort: () => {
                    if (writeSettled) {
                        return;
                    }
                    controller.abort();
                    resolveAborted(false);
                }
            };
            this.activeWrite = activeWrite;

            let saved = false;
            try {
                saved = await Promise.race([this.write(batch, controller.signal), aborted]);
            } catch {
                saved = false;
            } finally {
                writeSettled = true;
                if (this.activeWrite === activeWrite) {
                    this.activeWrite = null;
                }
            }
            if (!saved) {
                this.rejected = true;
                this.clearPending();
            }
            return saved;
        });
        this.writeChain = currentWrite;
        return currentWrite;
    }

    async flushForCancellation(): Promise<CancellationCacheFlushResult> {
        if (this.discarded) {
            return "discarded";
        }
        if (this.cancellationTimedOut) {
            return "timed-out";
        }

        const saved = await this.flush();
        const result: CancellationCacheFlushResult = this.cancellationTimedOut
            ? "timed-out"
            : this.discarded
              ? "discarded"
              : saved
                ? "saved"
                : "failed";
        this.cancelCancellationTimer();
        return result;
    }

    discard(): void {
        this.discarded = true;
        this.rejected = true;
        this.cancelTimer();
        this.cancelCancellationTimer();
        this.clearPending();
        this.abortActiveWrite();
    }

    dispose(): void {
        this.cancelTimer();
        this.cancelCancellationTimer();
        this.unsubscribeCancellation?.();
        this.unsubscribeCancellation = null;
    }

    private ensureScheduledFlush(): void {
        if (this.cancelScheduledFlush || this.pending.size === 0) {
            return;
        }
        this.cancelScheduledFlush = this.schedule(this.policy.maxDelayMs, () => {
            this.cancelScheduledFlush = null;
            void this.flush().catch(() => undefined);
        });
    }

    private cancelTimer(): void {
        this.cancelScheduledFlush?.();
        this.cancelScheduledFlush = null;
    }

    private requestCancellation(mode: DownloadCancellationMode): void {
        if (mode === "discard") {
            this.discard();
            return;
        }
        if (this.discarded || this.rejected || this.cancellationTimedOut || this.cancelCancellationDeadline) {
            return;
        }

        this.cancelCancellationDeadline = this.schedule(this.cancellationTimeoutMs, () => {
            this.cancelCancellationDeadline = null;
            this.cancellationTimedOut = true;
            this.rejected = true;
            this.cancelTimer();
            this.clearPending();
            this.abortActiveWrite();
        });
    }

    private cancelCancellationTimer(): void {
        this.cancelCancellationDeadline?.();
        this.cancelCancellationDeadline = null;
    }

    private abortActiveWrite(): void {
        this.activeWrite?.abort();
    }

    private clearPending(): void {
        this.pending.clear();
        this.pendingBytes = 0;
    }
}

/**
 * 估算章节写入 IndexedDB 时占用的字节数
 */
export function estimateChapterCacheBytes(chapter: Chapter): number {
    const encoder = new TextEncoder();
    let bytes = encoder.encode(chapter.title + chapter.content + chapter.txtSegment).byteLength;
    for (const image of chapter.images || []) {
        bytes += image.blob.size;
        bytes += encoder.encode(image.id + image.mediaType).byteLength;
    }
    if (chapter.mappingFont) {
        bytes += chapter.mappingFont.blob.size;
        bytes += encoder.encode(
            chapter.mappingFont.family + chapter.mappingFont.mediaType + chapter.mappingFont.sha256
        ).byteLength;
    }
    return bytes;
}
