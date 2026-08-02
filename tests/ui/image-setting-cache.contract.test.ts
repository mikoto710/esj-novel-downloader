// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";

describe("image setting cache contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
    });

    it("changes the future task setting without clearing existing caches", async () => {
        const storage = await import("../../src/core/cache/book-cache");
        await storage.claimBookCache("700", "task-700", false);
        await storage.putBookCacheBatchForTask(
            "700",
            "task-700",
            new Map([[0, createChapter(0)]]),
            createCacheMeta({ bookId: "700", imageEnabled: false, updatedAt: Date.now() })
        );
        const { createSettingsPanel } = await import("../../src/ui/popups");
        createSettingsPanel();
        const imageSetting = document.querySelector("#esj-settings .esj-switch input") as HTMLInputElement;

        imageSetting.checked = true;
        imageSetting.dispatchEvent(new Event("change", { bubbles: true }));

        expect(GM_getValue("enable_image_download", false)).toBe(true);
        expect((await storage.loadBookCache("700")).size).toBe(1);
        expect(document.querySelector("#esj-image-cache-confirm")).toBeNull();
    });
});
