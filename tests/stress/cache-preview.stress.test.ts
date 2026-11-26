// @vitest-environment jsdom

import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { acquireCacheLock } from "../support/book-cache";
import { createCacheMeta, createChapter, createChapterImage } from "../support";

describe("large cache preview", () => {
    it("previews 3000 image chapters without reading their values", async () => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        vi.stubGlobal("Blob", NodeBlob);
        const storage = await import("../../src/storage/cache/book-cache");
        const image = createChapterImage(0, { blob: new Blob([new Uint8Array(32 * 1024)], { type: "image/jpeg" }) });
        const chapters = new Map(
            Array.from({ length: 3_000 }, (_, index) => [index, createChapter(index, { images: [image] })])
        );
        const sources = new Map(Array.from(chapters.keys(), (index) => [index, `esj:3000/${index + 1}`]));
        const { releaseBookDownloadLock } = await import("../../src/storage/book-lock");
        const lock = await acquireCacheLock("3000");
        await storage.claimBookCache("3000", lock.taskId, true);
        await storage.putBookCacheBatchForTask(
            "3000",
            lock.taskId,
            chapters,
            createCacheMeta({ bookId: "3000", imageEnabled: true, totalChapters: 3_000 }),
            undefined,
            sources
        );
        const get = vi.spyOn(IDBObjectStore.prototype, "get");
        const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");

        const preview = await storage.previewBookCache("3000", true, sources);
        expect(preview).toMatchObject({ valid: true, size: 3_000, compatibility: "compatible" });
        expect(preview.indexes).toEqual(Array.from(chapters.keys()));
        expect(getAll).toHaveBeenCalledOnce();
        expect(getAll.mock.calls[0][0]).toMatchObject({ lower: ["chapter-source", "3000", 0] });
        expect(get.mock.calls.every(([key]) => Array.isArray(key) && key[0] === "manifest")).toBe(true);
        await releaseBookDownloadLock(lock);
    });
});
