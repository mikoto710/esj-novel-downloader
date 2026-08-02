// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChapter } from "../support";

const mocks = vi.hoisted(() => ({
    readManifest: vi.fn(),
    readChapters: vi.fn(),
    claim: vi.fn(),
    clear: vi.fn(),
    clearForTask: vi.fn(),
    listManifests: vi.fn(),
    putBatch: vi.fn(),
    readLegacy: vi.fn(),
    deleteLegacy: vi.fn(),
    listLegacy: vi.fn(),
    publish: vi.fn()
}));

vi.mock("../../src/core/cache/indexeddb-repository", () => ({
    readCacheManifestV3: mocks.readManifest,
    readCacheChaptersV3: mocks.readChapters,
    claimCacheV3: mocks.claim,
    clearCacheV3: mocks.clear,
    clearCacheV3ForTask: mocks.clearForTask,
    listCacheManifestsV3: mocks.listManifests,
    putCacheBatchV3: mocks.putBatch
}));
vi.mock("../../src/core/cache/legacy-cache", () => ({
    readLegacyCache: mocks.readLegacy,
    deleteLegacyCache: mocks.deleteLegacy,
    listLegacyCacheRecords: mocks.listLegacy,
    getLegacyCacheBookId: (key: string) => key.replace(/^esj_down_(?:book_)?/, "")
}));
vi.mock("../../src/core/cache/sync", () => ({
    publishCacheSyncEvent: mocks.publish,
    subscribeCacheSync: vi.fn(() => vi.fn())
}));
vi.mock("../../src/core/book-lock", () => ({
    hasBookDownloadTaskPresence: vi.fn(() => false),
    listActiveBookDownloadLocks: vi.fn(async () => [])
}));

describe("v2 cache migration recovery", () => {
    const chapter = createChapter(0, { content: "legacy chapter" });
    const legacyRecord = {
        key: "esj_down_book_200",
        data: { version: 2, ts: Date.now(), chapters: [[0, chapter] as [number, typeof chapter]] }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readManifest.mockResolvedValue(undefined);
        mocks.readChapters.mockResolvedValue(new Map([[0, chapter]]));
        mocks.readLegacy.mockResolvedValue(legacyRecord);
        mocks.deleteLegacy.mockResolvedValue(undefined);
        mocks.listManifests.mockResolvedValue([]);
        mocks.listLegacy.mockResolvedValue([]);
        mocks.clear.mockResolvedValue(true);
        mocks.clearForTask.mockResolvedValue(true);
        mocks.putBatch.mockResolvedValue(true);
    });

    it("retries an interrupted migration once before deleting v2", async () => {
        mocks.claim
            .mockRejectedValueOnce(new DOMException("transaction aborted", "AbortError"))
            .mockResolvedValueOnce(undefined);
        const storage = await import("../../src/core/cache/book-cache");

        await expect(storage.claimBookCache("200", "task-200")).resolves.toMatchObject({ size: 1 });

        expect(mocks.claim).toHaveBeenCalledTimes(2);
        expect(mocks.deleteLegacy).toHaveBeenCalledOnce();
        expect(mocks.deleteLegacy).toHaveBeenCalledWith("200");
    });

    it("keeps v2 readable after migration retry fails and succeeds on a later attempt", async () => {
        mocks.claim.mockRejectedValue(new DOMException("storage full", "QuotaExceededError"));
        const storage = await import("../../src/core/cache/book-cache");

        await expect(storage.claimBookCache("200", "task-200")).rejects.toMatchObject({
            reason: "migration-failed",
            operation: "migrate",
            causeReason: "quota-exceeded"
        });
        expect(mocks.claim).toHaveBeenCalledTimes(2);
        expect(mocks.deleteLegacy).not.toHaveBeenCalled();
        await expect(storage.loadBookCache("200")).resolves.toMatchObject({ size: 1 });

        mocks.claim.mockReset().mockResolvedValue(undefined);
        await expect(storage.claimBookCache("200", "task-200")).resolves.toMatchObject({ size: 1 });
        expect(mocks.deleteLegacy).toHaveBeenCalledOnce();
    });

    it("does not silently treat an unavailable database as an empty cache", async () => {
        mocks.readManifest.mockRejectedValue(new DOMException("database disabled", "InvalidStateError"));
        const storage = await import("../../src/core/cache/book-cache");

        await expect(storage.loadBookCache("200")).rejects.toMatchObject({
            reason: "database-unavailable",
            operation: "read"
        });
    });
});
