// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookLock, createCacheMeta, createCachedData, createChapter, createDeferred } from "../support";

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
        runtime.state.globalChaptersMap = new Map([[0, createChapter()]]);
        runtime.startRuntimeCacheSession(createCacheMeta(), "new-task", 1);
    });

    it("clears a task summary without clearing the previous export or task chapters", () => {
        const previous = runtime.state.cachedData;
        const chapters = runtime.state.globalChaptersMap;
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
        expect(runtime.state.globalChaptersMap.size).toBe(1);
    });

    it("ignores an old clear notification when the current writer still owns the cache", async () => {
        mocks.readManifest.mockResolvedValue({ writerTaskId: "new-task", cleared: false });
        mocks.activeLock.mockResolvedValue(createBookLock({ taskId: "new-task" }));
        await send({ type: "cache-cleared", bookId: "100" });
        expect(runtime.state.runtimeCacheSession?.taskId).toBe("new-task");
        expect(runtime.state.globalChaptersMap.size).toBe(1);
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
        const { finalizeBookDownloadTask } = await import("../../src/core/download/task-finalizer");
        await finalizeBookDownloadTask(createBookLock({ taskId: "new-task" }), vi.fn());
        expect(runtime.state.cachedData).toBe(previous);
        expect(runtime.state.globalChaptersMap.size).toBe(1);
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
});
