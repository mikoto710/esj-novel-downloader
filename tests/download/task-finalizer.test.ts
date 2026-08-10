// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookLock } from "../support";

const mocks = vi.hoisted(() => ({
    release: vi.fn(),
    shouldDiscard: vi.fn(),
    clearCache: vi.fn(),
    clearRuntimeSession: vi.fn()
}));

vi.mock("../../src/core/book-lock", () => ({
    releaseBookDownloadLock: mocks.release,
    shouldDiscardBookDownloadCache: mocks.shouldDiscard
}));
vi.mock("../../src/core/cache/book-cache", () => ({ clearBookCacheForTask: mocks.clearCache }));
vi.mock("../../src/core/state", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../src/core/state")>();
    return { ...original, clearRuntimeCacheSession: mocks.clearRuntimeSession };
});
import { finalizeBookDownloadTask } from "../../src/core/download/task-finalizer";
import { state } from "../../src/core/state";

describe("book download task finalization", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.release.mockResolvedValue(undefined);
        mocks.shouldDiscard.mockResolvedValue(true);
        mocks.clearCache.mockResolvedValue(true);
    });

    it("returns a cache clear failure while still releasing the task lock", async () => {
        const lock = createBookLock();
        const stopHeartbeat = vi.fn();
        state.activeBookLock = lock;
        mocks.clearCache.mockRejectedValueOnce(new DOMException("transaction aborted", "AbortError"));

        const result = await finalizeBookDownloadTask(lock, stopHeartbeat);

        expect(result).toMatchObject({
            cacheDiscarded: false,
            cacheClearFailure: { reason: "transaction-aborted", operation: "clear" }
        });
        expect(stopHeartbeat).toHaveBeenCalledOnce();
        expect(mocks.release).toHaveBeenCalledWith(lock, { cacheDiscarded: false });
        expect(state.activeBookLock).toBeNull();
    });

    it("reports an ownership loss when the writer declines cache deletion", async () => {
        const lock = createBookLock();
        mocks.clearCache.mockResolvedValueOnce(false);

        const result = await finalizeBookDownloadTask(lock, vi.fn());

        expect(result.cacheClearFailure).toMatchObject({ reason: "ownership-lost", operation: "clear" });
        expect(mocks.release).toHaveBeenCalledWith(lock, { cacheDiscarded: false });
    });
});
