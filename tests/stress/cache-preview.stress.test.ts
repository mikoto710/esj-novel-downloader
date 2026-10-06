// @vitest-environment jsdom

import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter, createChapterImage } from "../support";

describe("large cache preview", () => {
    it("previews 3000 image chapters without reading their values or granting an unconfirmed writer", async () => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        vi.stubGlobal("Blob", NodeBlob);
        const storage = await import("../../src/storage/cache/book-cache");
        const image = createChapterImage(0, { blob: new Blob([new Uint8Array(32 * 1024)], { type: "image/jpeg" }) });
        const chapters = new Map(
            Array.from({ length: 3_000 }, (_, index) => [index, createChapter(index, { images: [image] })])
        );
        await storage.claimBookCache("3000", "previous-task", true);
        await storage.putBookCacheBatchForTask(
            "3000",
            "previous-task",
            chapters,
            createCacheMeta({ bookId: "3000", imageEnabled: true, totalChapters: 3_000 })
        );
        const get = vi.spyOn(IDBObjectStore.prototype, "get");
        const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");

        const preview = await storage.previewBookCache("3000", true);
        expect(preview).toMatchObject({ valid: true, size: 3_000, compatibility: "compatible" });
        expect(preview.indexes).toEqual(Array.from(chapters.keys()));
        await expect(storage.claimBookCache("3000", "new-task", false, undefined, {})).resolves.toMatchObject({
            status: "needs-confirmation",
            size: 3_000
        });
        expect(getAll).not.toHaveBeenCalled();
        expect(get.mock.calls.every(([key]) => !Array.isArray(key) || key[0] === "manifest")).toBe(true);

        await expect(
            storage.putBookCacheBatchForTask("3000", "previous-task", new Map([[0, createChapter(0)]]))
        ).resolves.toBe(true);
        expect((await storage.previewBookCache("3000", true)).size).toBe(3_000);
    });
});
