import type { Chapter, DownloadCancellationMode } from "../../types";
import {
    createStorageError,
    normalizeStorageError,
    toStorageFailure,
    type StorageFailure
} from "../cache/storage-error";

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
    private sealed = false;
    private cancellationTimedOut = false;
    private discarded = false;
    private storageFailure: StorageFailure | null = null;

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

    get failure(): StorageFailure | null {
        return this.storageFailure ? { ...this.storageFailure } : null;
    }

    /**
     * 将章节合并到待写批次，并在达到数量或容量阈值时等待立即刷新
     * 返回 false 表示缓冲区已停止接受章节，或本次触发的缓存写入失败
     */
    async add(index: number, chapter: Chapter): Promise<boolean> {
        if (this.sealed || this.rejected || this.discarded) {
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

    /**
     * 永久停止接收新章节并等待当前批次及既有写入链完成
     * 重复调用保持幂等，供范围任务在关闭持久 writer 前建立明确写入边界
     */
    async seal(): Promise<boolean> {
        this.sealed = true;
        this.cancelTimer();
        return this.flush();
    }

    /**
     * 串行写入调用时待处理的批次，没有新章节时等待已启动的写入链完成
     * 返回 false 表示批次未保存，且缓冲区将停止接受新章节
     */
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
            } catch (error) {
                if (!this.discarded && !this.cancellationTimedOut) {
                    const normalized = normalizeStorageError(error, "write");
                    this.storageFailure = toStorageFailure(normalized);
                }
                saved = false;
            } finally {
                writeSettled = true;
                if (this.activeWrite === activeWrite) {
                    this.activeWrite = null;
                }
            }
            if (!saved && !this.discarded && !this.cancellationTimedOut && !this.storageFailure) {
                this.storageFailure = toStorageFailure(createStorageError("ownership-lost", "write"));
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

    /**
     * 在取消收尾期限内刷新待写章节，并区分保存、失败、超时和主动丢弃结果
     */
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

    /**
     * 永久丢弃待写章节、取消定时刷新并中止活动写入，调用后该缓冲区不再接受章节
     */
    discard(): void {
        this.discarded = true;
        this.rejected = true;
        this.cancelTimer();
        this.cancelCancellationTimer();
        this.clearPending();
        this.abortActiveWrite();
    }

    /**
     * 仅停止定时器并取消取消事件订阅，不自动刷新或丢弃尚未写入的章节
     */
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
            this.storageFailure = toStorageFailure(createStorageError("flush-timeout", "flush"));
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
