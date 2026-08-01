import type { Chapter } from "../../types";

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
    write(entries: ReadonlyMap<number, Chapter>): Promise<boolean>;
    schedule(delayMs: number, callback: () => void): () => void;
    estimateBytes?(chapter: Chapter): number;
}

/**
 * 合并并串行写入下载过程中发生变化的章节
 */
export class ChapterCacheWriteBuffer {
    private readonly policy: CacheWritePolicy;
    private readonly write: CacheWriteBufferOptions["write"];
    private readonly schedule: CacheWriteBufferOptions["schedule"];
    private readonly estimateBytes: NonNullable<CacheWriteBufferOptions["estimateBytes"]>;
    private pending = new Map<number, Chapter>();
    private pendingBytes = 0;
    private cancelScheduledFlush: (() => void) | null = null;
    private writeChain = Promise.resolve(true);
    private rejected = false;

    constructor(options: CacheWriteBufferOptions) {
        this.policy = options.policy || DEFAULT_CACHE_WRITE_POLICY;
        this.write = options.write;
        this.schedule = options.schedule;
        this.estimateBytes = options.estimateBytes || estimateChapterCacheBytes;
    }

    get dirtyChapterCount(): number {
        return this.pending.size;
    }

    get dirtyBytes(): number {
        return this.pendingBytes;
    }

    async add(index: number, chapter: Chapter): Promise<boolean> {
        if (this.rejected) {
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
        if (this.pending.size === 0) {
            return this.writeChain;
        }

        this.cancelTimer();
        const batch = this.pending;
        this.pending = new Map();
        this.pendingBytes = 0;

        const previousWrite = this.writeChain;
        const currentWrite = previousWrite.then(async (previousSaved) => {
            if (!previousSaved || this.rejected) {
                return false;
            }
            const saved = await this.write(batch);
            if (!saved) {
                this.rejected = true;
            }
            return saved;
        });
        this.writeChain = currentWrite;
        return currentWrite;
    }

    discard(): void {
        this.cancelTimer();
        this.pending.clear();
        this.pendingBytes = 0;
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
    return bytes;
}
