// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createBookLock,
    createCacheMeta,
    createCachedData,
    createChapter,
    createDeferred,
    createDownloadTask
} from "../support";
import { createDownloadHarness } from "../support/download-harness";

const mocks = vi.hoisted(() => ({
    readManifest: vi.fn(),
    activeLock: vi.fn(),
    activeLocks: vi.fn(),
    clearCache: vi.fn(),
    clearAll: vi.fn(),
    listCaches: vi.fn(),
    shouldDiscard: vi.fn(),
    release: vi.fn()
}));
vi.mock("../../src/core/cache/indexeddb-repository", () => ({ readCacheManifestV3: mocks.readManifest }));
vi.mock("../../src/core/cache/book-cache", () => ({
    clearBookCache: mocks.clearCache,
    clearBookCacheForTask: mocks.clearCache,
    clearAllPersistentCaches: mocks.clearAll,
    listBookCaches: mocks.listCaches
}));
vi.mock("../../src/core/book-lock", () => ({
    getActiveBookDownloadLock: mocks.activeLock,
    listActiveBookDownloadLocks: mocks.activeLocks,
    shouldDiscardBookDownloadCache: mocks.shouldDiscard,
    releaseBookDownloadLock: mocks.release
}));

let receive: (event: MessageEvent) => void;
let runtime: typeof import("../../src/core/state");
let chapters: Map<number, import("../../src/types").Chapter>;
let manager: typeof import("../../src/core/cache/manager");

async function send(event: object): Promise<void> {
    receive({ data: event } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runtime cache ownership", () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal(
            "BroadcastChannel",
            class {
                addEventListener(_type: string, listener: typeof receive) {
                    receive = listener;
                }
                postMessage() {}
            }
        );
        mocks.readManifest.mockResolvedValue(undefined);
        mocks.activeLock.mockResolvedValue(null);
        mocks.activeLocks.mockResolvedValue([]);
        mocks.listCaches.mockResolvedValue([]);
        mocks.clearCache.mockResolvedValue(true);
        mocks.clearAll.mockResolvedValue([]);
        mocks.shouldDiscard.mockResolvedValue(true);
        mocks.release.mockResolvedValue(undefined);
        runtime = await import("../../src/core/state");
        manager = await import("../../src/core/cache/manager");
        runtime.state.cachedData = createCachedData();
        chapters = new Map([[0, createChapter()]]);
        runtime.startRuntimeCacheSession(createCacheMeta(), "new-task", 1);
    });

    it("clears a task summary without clearing the previous export or task chapters", () => {
        const previous = runtime.state.cachedData;
        runtime.clearRuntimeCacheSession("100");
        expect(runtime.state.runtimeCacheSession).toBeNull();
        expect(runtime.state.cachedData).toBe(previous);
        expect(chapters.size).toBe(1);
    });

    it.each(["cache-cleared", "cache-claimed"])("preserves export and chapters after remote %s", async (type) => {
        const previous = runtime.state.cachedData;
        mocks.readManifest.mockResolvedValue({ writerTaskId: "remote-task", cleared: type === "cache-cleared" });
        await send({ type, bookId: "100", taskId: "remote-task" });
        expect(runtime.state.runtimeCacheSession).toBeNull();
        expect(runtime.state.cachedData).toBe(previous);
        expect(chapters.size).toBe(1);
    });

    it("ignores an old clear notification when the current writer still owns the cache", async () => {
        mocks.readManifest.mockResolvedValue({ writerTaskId: "new-task", cleared: false });
        mocks.activeLock.mockResolvedValue(createBookLock({ taskId: "new-task" }));
        await send({ type: "cache-cleared", bookId: "100" });
        expect(runtime.state.runtimeCacheSession?.taskId).toBe("new-task");
        expect(chapters.size).toBe(1);
        expect(mocks.readManifest).toHaveBeenCalledWith("100");
    });

    it("does not apply a delayed ownership check to a newer task", async () => {
        const read = createDeferred<undefined>();
        mocks.readManifest.mockReturnValue(read.promise);
        receive({ data: { type: "cache-cleared", bookId: "100" } } as MessageEvent);
        runtime.startRuntimeCacheSession(createCacheMeta(), "newer-task", 2);
        read.resolve(undefined);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(runtime.state.runtimeCacheSession?.taskId).toBe("newer-task");
    });

    it("preserves the export when stopping and discarding a new task", async () => {
        const previous = runtime.state.cachedData;
        const { finalizeBookDownloadTask } = await import("../../src/adapters/book-download-lifecycle");
        await finalizeBookDownloadTask(createBookLock({ taskId: "new-task" }), vi.fn());
        expect(runtime.state.cachedData).toBe(previous);
        expect(chapters.size).toBe(1);
        expect(runtime.state.runtimeCacheSession).toBeNull();
    });

    it("clears an explicitly selected export by its own book rather than the newer session", async () => {
        runtime.startRuntimeCacheSession(createCacheMeta({ bookId: "200" }), "task-200", 1);
        await manager.clearManagedCache("200", "runtime");
        expect(runtime.state.cachedData?.exportContext?.bookId).toBe("100");
        await manager.clearManagedCache("100", "runtime");
        expect(runtime.state.cachedData).toBeNull();
    });

    it("retains protected session state while clearing an unprotected previous export", async () => {
        runtime.startRuntimeCacheSession(createCacheMeta({ bookId: "200" }), "task-200", 1);
        mocks.activeLocks.mockResolvedValue([createBookLock({ bookId: "200", taskId: "task-200" })]);
        await manager.clearAllManagedCaches(true);
        expect(runtime.state.runtimeCacheSession?.bookId).toBe("200");
        expect(runtime.state.cachedData).toBeNull();
    });

    it("lists the previous export separately while another book downloads", async () => {
        runtime.startRuntimeCacheSession(createCacheMeta({ bookId: "200" }), "task-200", 1);
        const items = await manager.listManagedCaches();
        expect(items.find((item) => item.bookId === "100")).toMatchObject({
            hasExportData: true,
            sources: ["runtime"]
        });
        expect(items.find((item) => item.bookId === "200")).toMatchObject({ hasExportData: false });
    });

    it("keeps new task inventory and image settings separate from its previous export", async () => {
        runtime.state.cachedData = createCachedData({
            chapters: [createChapter(0), createChapter(1), createChapter(2)]
        });
        runtime.startRuntimeCacheSession(createCacheMeta({ imageEnabled: true }), "new-task", 1);
        const items = await manager.listManagedCaches();
        expect(items[0]).toMatchObject({
            runtimeChapterCount: 1,
            progressCount: 1,
            imageEnabled: true,
            hasExportData: true
        });
    });

    it("requests task cancellation on ownership loss without clearing its chapter table", async () => {
        const cancellation = runtime.createDownloadCancellation();
        runtime.activateDownload("100", "new-task", cancellation);
        mocks.readManifest.mockResolvedValue({ writerTaskId: "remote-task", cleared: false });
        await send({ type: "cache-claimed", bookId: "100", taskId: "remote-task" });
        expect(cancellation.isCancellationRequested()).toBe(true);
        expect(chapters.size).toBe(1);
        expect(runtime.state.cachedData).not.toBeNull();
    });

    it("lets the running core finalize ownership loss while retaining the previous export", async () => {
        const tasks = Array.from({ length: 3 }, (_, index) => createDownloadTask(index));
        const harness = createDownloadHarness(tasks, chapters);
        const started = createDeferred<void>();
        const response = createDeferred<string>();
        const cancellation = runtime.createDownloadCancellation();
        runtime.activateDownload("100", "new-task", cancellation);
        harness.dependencies.cancellation = cancellation;
        harness.dependencies.lock.owns = async () => false;
        harness.dependencies.chapterFetcher.fetch = async () => {
            started.resolve();
            return response.promise;
        };
        const previous = runtime.state.cachedData;
        const download = harness.run({
            bookId: "100",
            taskId: "new-task",
            bookName: "Book",
            introTxt: "",
            description: "",
            tags: [],
            imageEnabled: false,
            tasks
        });
        await started.promise;
        mocks.readManifest.mockResolvedValue({ writerTaskId: "remote-task", cleared: false });
        await send({ type: "cache-claimed", bookId: "100", taskId: "remote-task" });
        response.resolve("<p>late chapter</p>");
        expect(await download).toEqual({ status: "cancelled", outcome: "ownership-lost" });
        expect(harness.dependencies.chapters).toBe(chapters);
        expect(chapters.size).toBe(1);
        expect(harness.cacheClears).toEqual([]);
        expect(runtime.state.cachedData).toBe(previous);
    });

    it("ignores stale task progress and export publication", () => {
        runtime.activateDownload("100", "new-task", runtime.createDownloadCancellation());
        runtime.updateRuntimeCacheSession({ completedCount: 10 }, "old-task");
        const previous = runtime.state.cachedData;
        runtime.publishCachedExport(createCachedData(), "old-task");
        expect(runtime.state.runtimeCacheSession?.completedCount).toBe(0);
        expect(runtime.state.cachedData).toBe(previous);
    });

    it("invalidates only the derived EPUB when settings change", () => {
        const data = runtime.state.cachedData!;
        data.epubBlob = new Blob(["epub"]);
        runtime.invalidateCachedEpub();
        expect(runtime.state.cachedData).toBe(data);
        expect(data.epubBlob).toBeNull();
        expect(data.chapters).toHaveLength(1);
    });
});
