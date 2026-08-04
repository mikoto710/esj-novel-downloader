// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";

const { listActiveBookDownloadLocks } = vi.hoisted(() => ({
    listActiveBookDownloadLocks: vi.fn()
}));

vi.mock("../../src/core/book-lock", () => ({
    hasBookDownloadTaskPresence: vi.fn(() => false),
    listActiveBookDownloadLocks
}));

describe("image setting cache contracts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
        listActiveBookDownloadLocks.mockResolvedValue([]);
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

        await vi.waitFor(() => expect(GM_getValue("enable_image_download", false)).toBe(true));

        expect((await storage.loadBookCache("700")).size).toBe(1);
        expect(document.querySelector("#esj-image-cache-confirm")).toBeNull();
    });

    it("warns about active full-book tasks and preserves the setting when cancelled", async () => {
        listActiveBookDownloadLocks.mockResolvedValue([{ bookId: "701" }, { bookId: "702" }]);
        const { createSettingsPanel } = await import("../../src/ui/popups");
        createSettingsPanel();
        const imageSetting = document.querySelector("#esj-settings .esj-switch input") as HTMLInputElement;

        imageSetting.checked = true;
        imageSetting.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() =>
            expect(document.querySelector("#esj-image-setting-task-confirm")?.textContent).toContain(
                "当前有 2 个全本任务正在下载"
            )
        );
        expect(document.querySelector("#esj-image-setting-task-confirm")?.textContent).toContain("不受本次切换影响");
        (document.querySelector("#esj-image-setting-task-confirm-cancel") as HTMLButtonElement).click();

        await vi.waitFor(() => expect(document.querySelector("#esj-image-setting-task-confirm")).toBeNull());
        expect(imageSetting.checked).toBe(false);
        expect(GM_getValue("enable_image_download", false)).toBe(false);
    });
});
