// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";

describe("image cache reconciliation contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("Blob", NodeBlob);
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
    });

    it("keeps normal cache restoration unchanged when settings match", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("500", "task-old", false);
        await storage.putBookCacheBatchForTask(
            "500",
            "task-old",
            new Map([[0, createChapter(0)]]),
            createCacheMeta({ bookId: "500", imageEnabled: false })
        );

        const claimed = await storage.claimBookCache("500", "task-new", false);

        expect(claimed).toMatchObject({ size: 1, compatibility: "compatible", invalidatedCount: 0 });
        expect(claimed.map?.get(0)?.title).toBeTruthy();
    });

    it.each([
        [false, true],
        [true, false]
    ])("invalidates all chapters when settings differ (%s -> %s)", async (cached, requested) => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("501", "task-old", cached);
        await storage.putBookCacheBatchForTask(
            "501",
            "task-old",
            new Map([
                [0, createChapter(0)],
                [1, createChapter(1)]
            ]),
            createCacheMeta({ bookId: "501", imageEnabled: cached })
        );

        const claimed = await storage.claimBookCache("501", "task-new", requested);

        expect(claimed).toMatchObject({
            size: 0,
            map: null,
            compatibility: "refetch-required",
            invalidatedCount: 2
        });
        expect((await storage.loadBookCache("501")).size).toBe(0);
    });

    it("keeps the independent cover when mismatched chapter cache is invalidated", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        const bytes = new Uint8Array(1_200);
        bytes.set([0xff, 0xd8, 0xff, 0xe0]);
        const cover = {
            blob: new Blob([bytes], { type: "image/jpeg" }),
            ext: "jpg" as const,
            mediaType: "image/jpeg" as const
        };
        await storage.claimBookCache("502", "task-old", false);
        await storage.putBookCacheBatchForTask(
            "502",
            "task-old",
            new Map([[0, createChapter(0)]]),
            createCacheMeta({ bookId: "502", imageEnabled: false })
        );
        await storage.putBookCoverForTask("502", "task-old", "https://img.example/cover.jpg", cover);

        await storage.claimBookCache("502", "task-new", true);

        expect((await storage.loadBookCache("502")).size).toBe(0);
        await expect(storage.loadBookCover("502", "https://img.example/cover.jpg")).resolves.not.toBeNull();
    });

    it("invalidates legacy cache whose image setting is unknown", async () => {
        const { get, set } = await import("idb-keyval");
        const storage = await import("../../src/core/cache/book-cache");
        await set("esj_down_book_503", {
            version: 2,
            ts: Date.now(),
            chapters: [[0, createChapter(0)]]
        });

        const claimed = await storage.claimBookCache("503", "task-new", false);

        expect(claimed).toMatchObject({
            size: 0,
            map: null,
            compatibility: "unknown",
            invalidatedCount: 1
        });
        expect(await get("esj_down_book_503")).toBeUndefined();
    });

    it("preserves the old cache when mismatch invalidation is aborted", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("504", "task-old", false);
        await storage.putBookCacheBatchForTask(
            "504",
            "task-old",
            new Map([[0, createChapter(0)]]),
            createCacheMeta({ bookId: "504", imageEnabled: false })
        );
        const controller = new AbortController();
        controller.abort();

        await expect(storage.claimBookCache("504", "task-new", true, controller.signal)).rejects.toMatchObject({
            name: "AbortError"
        });

        const restored = await storage.loadBookCache("504");
        expect(restored).toMatchObject({ size: 1, meta: { imageEnabled: false } });
    });
});
