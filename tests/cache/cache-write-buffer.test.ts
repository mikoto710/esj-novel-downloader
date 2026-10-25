import { describe, expect, it, vi } from "vitest";
import { ChapterCacheWriteBuffer, type CacheWritePolicy } from "../../src/download/cache-write-buffer";
import type { Chapter } from "../../src/content/model";
import type { DownloadCancellationMode } from "../../src/download/contracts";
import { createChapter, createDeferred, useFakeClock } from "../support";

describe("ChapterCacheWriteBuffer", () => {
    it("flushes only the dirty chapters when the chapter threshold is reached", async () => {
        const writes: number[][] = [];
        const buffer = createBuffer(
            { maxChapterCount: 3, maxBytes: Number.MAX_SAFE_INTEGER, maxDelayMs: 60_000 },
            async (entries) => {
                writes.push(Array.from(entries.keys()));
                return true;
            }
        );

        await buffer.add(0, createChapter(0));
        await buffer.add(1, createChapter(1));
        expect(writes).toEqual([]);
        await buffer.add(2, createChapter(2));

        expect(writes).toEqual([[0, 1, 2]]);
        expect(buffer.dirtyChapterCount).toBe(0);
    });

    it("flushes a single chapter that exceeds the byte threshold", async () => {
        const write = vi.fn(async (entries: ReadonlyMap<number, Chapter>) => entries.size >= 0);
        const buffer = createBuffer({ maxChapterCount: 25, maxBytes: 100, maxDelayMs: 60_000 }, write, () => 101);

        await expect(buffer.add(0, createChapter(0))).resolves.toBe(true);
        expect(write).toHaveBeenCalledOnce();
        expect(write.mock.calls[0][0]).toEqual(new Map([[0, createChapter(0)]]));
    });

    it("flushes at the byte limit when mapped font data is queued", async () => {
        const chapter = createChapter(0, { title: "", content: "", txtSegment: "" });
        const write = vi.fn(async (_entries: ReadonlyMap<number, Chapter>) => true);
        const buffer = createBuffer({ maxChapterCount: 25, maxBytes: 128, maxDelayMs: 60_000 }, write);
        const mappingFont = {
            family: "1",
            blob: new Blob([new Uint8Array(64)], { type: "font/woff2" }),
            mediaType: "font/woff2" as const,
            sha256: "a".repeat(64)
        };

        await buffer.add(0, chapter);
        expect(write).not.toHaveBeenCalled();
        await buffer.add(1, { ...chapter, mappingFont });

        expect(write).toHaveBeenCalledOnce();
        expect(Array.from(write.mock.calls[0][0].keys())).toEqual([0, 1]);
    });

    it("flushes pending chapters when the maximum delay elapses", async () => {
        const clock = useFakeClock();
        const write = vi.fn(async (entries: ReadonlyMap<number, Chapter>) => entries.size >= 0);
        const buffer = new ChapterCacheWriteBuffer({
            policy: { maxChapterCount: 25, maxBytes: 4 * 1024 * 1024, maxDelayMs: 3_000 },
            write,
            schedule: (delayMs, callback) => {
                const timer = setTimeout(callback, delayMs);
                return () => clearTimeout(timer);
            }
        });

        try {
            await buffer.add(0, createChapter(0));
            await clock.advanceBy(2_999);
            expect(write).not.toHaveBeenCalled();
            await clock.advanceBy(1);
            expect(write).toHaveBeenCalledOnce();
            expect(write.mock.calls[0][0]).toEqual(new Map([[0, createChapter(0)]]));
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            buffer.dispose();
            clock.restore();
        }
    });

    it("seals pending writes, rejects later chapters, and keeps repeated flushes idempotent", async () => {
        const write = vi.fn(async (_entries: ReadonlyMap<number, Chapter>) => true);
        const buffer = createBuffer(
            { maxChapterCount: 25, maxBytes: Number.MAX_SAFE_INTEGER, maxDelayMs: 60_000 },
            write
        );

        await expect(buffer.add(10, createChapter(10))).resolves.toBe(true);
        await expect(buffer.seal()).resolves.toBe(true);
        await expect(buffer.add(11, createChapter(11))).resolves.toBe(false);
        await expect(buffer.flush()).resolves.toBe(true);
        await expect(buffer.flushForCancellation()).resolves.toBe("saved");

        expect(write).toHaveBeenCalledOnce();
        expect(write.mock.calls[0][0]).toEqual(new Map([[10, createChapter(10)]]));
    });

    it("keeps chapters added while an earlier batch is still writing", async () => {
        const firstWrite = createDeferred<boolean>();
        const writes: number[][] = [];
        const write = vi.fn(async (entries: ReadonlyMap<number, Chapter>) => {
            writes.push(Array.from(entries.keys()));
            if (writes.length === 1) {
                return firstWrite.promise;
            }
            return true;
        });
        const buffer = createBuffer(
            { maxChapterCount: 1, maxBytes: Number.MAX_SAFE_INTEGER, maxDelayMs: 60_000 },
            write
        );

        const firstAdd = buffer.add(0, createChapter(0));
        await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
        const secondAdd = buffer.add(1, createChapter(1));
        firstWrite.resolve(true);

        await expect(Promise.all([firstAdd, secondAdd])).resolves.toEqual([true, true]);
        expect(writes).toEqual([[0], [1]]);
    });

    it("aborts an active write after the cancellation flush deadline", async () => {
        const clock = useFakeClock();
        const writeStarted = createDeferred<void>();
        let cancellationListener: (mode: DownloadCancellationMode) => void = () => undefined;
        let writeSignal: AbortSignal | undefined;
        const buffer = new ChapterCacheWriteBuffer({
            policy: { maxChapterCount: 1, maxBytes: Number.MAX_SAFE_INTEGER, maxDelayMs: 60_000 },
            write: async (_entries, signal) => {
                writeSignal = signal;
                writeStarted.resolve();
                return new Promise<boolean>((resolve) =>
                    signal.addEventListener("abort", () => resolve(false), { once: true })
                );
            },
            schedule: (delayMs, callback) => {
                const timer = setTimeout(callback, delayMs);
                return () => clearTimeout(timer);
            },
            subscribeCancellation: (listener) => {
                cancellationListener = listener;
                return () => undefined;
            },
            cancellationTimeoutMs: 5_000
        });

        try {
            const addPromise = buffer.add(0, createChapter(0));
            await writeStarted.promise;
            cancellationListener("flush");

            await clock.advanceBy(4_999);
            expect(writeSignal?.aborted).toBe(false);
            await clock.advanceBy(1);

            expect(writeSignal?.aborted).toBe(true);
            await expect(addPromise).resolves.toBe(false);
            await expect(buffer.flushForCancellation()).resolves.toBe("timed-out");
            expect(buffer.failure).toMatchObject({ reason: "flush-timeout", operation: "flush" });
        } finally {
            buffer.dispose();
            clock.restore();
        }
    });

    it.each([4_000, 6_000])(
        "counts the first cancellation deadline when saving starts after %i ms without a subscription",
        async (elapsed) => {
            const clock = useFakeClock();
            let requestedAt: number | null = null;
            let writeSignal: AbortSignal | undefined;
            const buffer = new ChapterCacheWriteBuffer({
                cancellation: {
                    mode: "flush" as const,
                    get requestedAt() {
                        return requestedAt;
                    }
                },
                write: async (_entries, signal) => {
                    writeSignal = signal;
                    return new Promise<boolean>((resolve) =>
                        signal.addEventListener("abort", () => resolve(false), { once: true })
                    );
                },
                schedule: (delay, callback) => {
                    const timer = setTimeout(callback, delay);
                    return () => clearTimeout(timer);
                }
            });
            try {
                await buffer.add(0, createChapter(0));
                requestedAt = Date.now();
                // 取消先发生，实际保存入口稍后才取得执行权；不能从入口重新给满五秒
                await clock.advanceBy(elapsed);
                const saving = buffer.flushForCancellation();
                if (elapsed < 5_000) {
                    await clock.advanceBy(999);
                    expect(writeSignal?.aborted).toBe(false);
                    await clock.advanceBy(1);
                }
                expect(writeSignal?.aborted).toBe(true);
                await expect(saving).resolves.toBe("timed-out");
            } finally {
                buffer.discard();
                buffer.dispose();
                clock.restore();
            }
        }
    );

    it("aborts an active write immediately when cancellation discards progress", async () => {
        const writeStarted = createDeferred<void>();
        let cancellationListener: (mode: DownloadCancellationMode) => void = () => undefined;
        let writeSignal: AbortSignal | undefined;
        const buffer = new ChapterCacheWriteBuffer({
            policy: { maxChapterCount: 1, maxBytes: Number.MAX_SAFE_INTEGER, maxDelayMs: 60_000 },
            write: async (_entries, signal) => {
                writeSignal = signal;
                writeStarted.resolve();
                return new Promise<boolean>((resolve) =>
                    signal.addEventListener("abort", () => resolve(false), { once: true })
                );
            },
            schedule: () => () => undefined,
            subscribeCancellation: (listener) => {
                cancellationListener = listener;
                return () => undefined;
            }
        });

        const addPromise = buffer.add(0, createChapter(0));
        await writeStarted.promise;
        cancellationListener("discard");

        expect(writeSignal?.aborted).toBe(true);
        await expect(addPromise).resolves.toBe(false);
        await expect(buffer.flushForCancellation()).resolves.toBe("discarded");
        buffer.dispose();
    });

    it("waits for an aborted write to finish before returning from flush", async () => {
        const started = createDeferred<void>();
        const stopped = createDeferred<void>();
        const release = createDeferred<void>();
        const buffer = new ChapterCacheWriteBuffer({
            policy: { maxChapterCount: 1, maxBytes: 1_000_000, maxDelayMs: 60_000 },
            schedule: () => () => undefined,
            write: async (_entries, signal) => {
                started.resolve();
                await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
                await release.promise;
                stopped.resolve();
                return false;
            }
        });
        let settled = false;
        const writing = buffer.add(0, createChapter()).then((result) => {
            settled = true;
            return result;
        });
        await started.promise;
        buffer.discard();
        try {
            await vi.waitFor(() => expect(settled).toBe(false), { timeout: 50 });
            // 消耗取消之后的微任务，Promise.race 提前返回会在此暴露
            for (let i = 0; i < 10; i++) await Promise.resolve();
            expect(settled).toBe(false);
            release.resolve();
            await expect(writing).resolves.toBe(false);
            await stopped.promise;
            await expect(buffer.flush()).resolves.toBe(false);
        } finally {
            release.resolve();
            await writing;
            buffer.dispose();
        }
    });

    it("preserves the classified reason after a write rejects", async () => {
        const buffer = createBuffer(
            { maxChapterCount: 1, maxBytes: Number.MAX_SAFE_INTEGER, maxDelayMs: 60_000 },
            async () => {
                throw new DOMException("storage full", "QuotaExceededError");
            }
        );

        await expect(buffer.add(0, createChapter(0))).resolves.toBe(false);
        expect(buffer.failure).toMatchObject({ reason: "quota-exceeded", operation: "write" });
    });
});

function createBuffer(
    policy: CacheWritePolicy,
    write: (entries: ReadonlyMap<number, Chapter>) => Promise<boolean>,
    estimateBytes?: (chapter: Chapter) => number
): ChapterCacheWriteBuffer {
    return new ChapterCacheWriteBuffer({
        policy,
        write,
        ...(estimateBytes === undefined ? {} : { estimateBytes }),
        schedule: () => () => undefined
    });
}
