import { describe, expect, it, vi } from "vitest";
import {
    ChapterCacheWriteBuffer,
    DEFAULT_CACHE_WRITE_POLICY,
    estimateChapterCacheBytes,
    type CacheWritePolicy
} from "../src/core/download/cache-write-buffer";
import type { Chapter } from "../src/types";
import type { DownloadCancellationMode } from "../src/types";
import { createChapter, createDeferred, useFakeClock } from "./support";

describe("ChapterCacheWriteBuffer", () => {
    it("uses the configurable 25 chapter, 4 MiB, and 3 second defaults", () => {
        expect(DEFAULT_CACHE_WRITE_POLICY).toEqual({
            maxChapterCount: 25,
            maxBytes: 4 * 1024 * 1024,
            maxDelayMs: 3_000
        });
    });

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

    it("includes the mapped font Blob and metadata in the byte estimate", () => {
        const chapter = createChapter();
        const plainBytes = estimateChapterCacheBytes(chapter);
        const mappingFont = {
            family: "1",
            blob: new Blob([new Uint8Array(64)], { type: "font/woff2" }),
            mediaType: "font/woff2" as const,
            sha256: "a".repeat(64)
        };

        expect(estimateChapterCacheBytes({ ...chapter, mappingFont })).toBe(
            plainBytes + 64 + new TextEncoder().encode("1font/woff2" + "a".repeat(64)).byteLength
        );
    });

    it("flushes pending chapters when the maximum delay elapses", async () => {
        const scheduled: { callback?: () => void } = {};
        const write = vi.fn(async (entries: ReadonlyMap<number, Chapter>) => entries.size >= 0);
        const buffer = new ChapterCacheWriteBuffer({
            policy: { maxChapterCount: 25, maxBytes: 4 * 1024 * 1024, maxDelayMs: 3_000 },
            write,
            schedule: (_delayMs, callback) => {
                scheduled.callback = callback;
                return () => {
                    delete scheduled.callback;
                };
            }
        });

        await buffer.add(0, createChapter(0));
        expect(write).not.toHaveBeenCalled();
        expect(scheduled.callback).toBeTypeOf("function");
        scheduled.callback?.();

        await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    });

    it("does not repeat a completed write when flush is called again", async () => {
        const write = vi.fn(async (entries: ReadonlyMap<number, Chapter>) => entries.size >= 0);
        const buffer = createBuffer({ maxChapterCount: 25, maxBytes: 4 * 1024 * 1024, maxDelayMs: 60_000 }, write);

        await buffer.add(0, createChapter(0));
        await buffer.flush();
        await buffer.flush();

        expect(write).toHaveBeenCalledOnce();
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
                return new Promise<boolean>(() => undefined);
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
        } finally {
            buffer.dispose();
            clock.restore();
        }
    });

    it("aborts an active write immediately when cancellation discards progress", async () => {
        const writeStarted = createDeferred<void>();
        let cancellationListener: (mode: DownloadCancellationMode) => void = () => undefined;
        let writeSignal: AbortSignal | undefined;
        const buffer = new ChapterCacheWriteBuffer({
            policy: { maxChapterCount: 1, maxBytes: Number.MAX_SAFE_INTEGER, maxDelayMs: 60_000 },
            write: async (_entries, signal) => {
                writeSignal = signal;
                writeStarted.resolve();
                return new Promise<boolean>(() => undefined);
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
});

function createBuffer(
    policy: CacheWritePolicy,
    write: (entries: ReadonlyMap<number, Chapter>) => Promise<boolean>,
    estimateBytes?: (chapter: Chapter) => number
): ChapterCacheWriteBuffer {
    return new ChapterCacheWriteBuffer({
        policy,
        write,
        estimateBytes,
        schedule: () => () => undefined
    });
}
