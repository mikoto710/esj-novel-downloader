// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookCover } from "../../src/types";

function createCover(format: "jpg" | "png" = "jpg"): BookCover {
    const bytes = new Uint8Array(1_200);
    if (format === "png") {
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return { blob: new Blob([bytes], { type: "image/png" }), ext: "png", mediaType: "image/png" };
    }
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    return { blob: new Blob([bytes], { type: "image/jpeg" }), ext: "jpg", mediaType: "image/jpeg" };
}

describe("independent cover cache contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("Blob", NodeBlob);
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
    });

    it("stores a cover outside the manifest and reuses the exact URL", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        const cover = createCover("png");
        await storage.claimBookCache("400", "task-400", false);

        await expect(
            storage.putBookCoverForTask("400", "task-400", "https://img.example/cover.png", cover)
        ).resolves.toBe(true);

        await expect(storage.loadBookCover("400", "https://img.example/cover.png")).resolves.toMatchObject({
            ext: "png",
            mediaType: "image/png"
        });
        expect((await storage.loadBookCache("400")).size).toBe(0);
    });

    it("atomically replaces an old URL without reusing its Blob", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("401", "task-401", false);
        await storage.putBookCoverForTask("401", "task-401", "https://img.example/old.jpg", createCover("jpg"));
        await storage.putBookCoverForTask("401", "task-401", "https://img.example/new.png", createCover("png"));

        await expect(storage.loadBookCover("401", "https://img.example/old.jpg")).resolves.toBeNull();
        await expect(storage.loadBookCover("401", "https://img.example/new.png")).resolves.toMatchObject({
            ext: "png"
        });
    });

    it("prevents a stale writer from replacing a newer task cover", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("402", "task-old", false);
        await storage.putBookCoverForTask("402", "task-old", "https://img.example/current.jpg", createCover("jpg"));
        await storage.claimBookCache("402", "task-new", false);

        await expect(
            storage.putBookCoverForTask("402", "task-old", "https://img.example/stale.png", createCover("png"))
        ).resolves.toBe(false);
        await expect(storage.loadBookCover("402", "https://img.example/current.jpg")).resolves.not.toBeNull();
        await expect(storage.loadBookCover("402", "https://img.example/stale.png")).resolves.toBeNull();
    });

    it("clears the cover in the same task-owned book cleanup", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("403", "task-403", false);
        await storage.putBookCoverForTask("403", "task-403", "https://img.example/cover.jpg", createCover("jpg"));

        await expect(storage.clearBookCacheForTask("403", "task-403")).resolves.toBe(true);
        await expect(storage.loadBookCover("403", "https://img.example/cover.jpg")).resolves.toBeNull();
    });

    it("clears the cover through the cache manager book cleanup", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("405", "task-405", false);
        await storage.putBookCoverForTask("405", "task-405", "https://img.example/cover.jpg", createCover("jpg"));

        await expect(storage.clearBookCache("405")).resolves.toBe(true);
        await expect(storage.loadBookCover("405", "https://img.example/cover.jpg")).resolves.toBeNull();
    });

    it("does not write a cover after its transaction signal is cancelled", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("404", "task-404", false);
        const controller = new AbortController();
        controller.abort();

        await expect(
            storage.putBookCoverForTask(
                "404",
                "task-404",
                "https://img.example/cover.jpg",
                createCover("jpg"),
                controller.signal
            )
        ).resolves.toBe(false);
        await expect(storage.loadBookCover("404", "https://img.example/cover.jpg")).resolves.toBeNull();
    });
});
