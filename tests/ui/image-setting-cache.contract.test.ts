// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCacheMeta, createChapter } from "../support";
import { acquireCacheLock } from "../support/book-cache";

const { listActiveBookDownloadLocks } = vi.hoisted(() => ({
    listActiveBookDownloadLocks: vi.fn()
}));

vi.mock("../../src/storage/book-lock", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/storage/book-lock")>()),
    listActiveBookDownloadLocks
}));

describe("image setting cache contracts", () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.stubGlobal("BroadcastChannel", undefined);
        localStorage.clear();
        listActiveBookDownloadLocks.mockResolvedValue([]);
        const { setInterfaceLocalePreference } = await import("../../src/storage/settings");
        setInterfaceLocalePreference("zh-CN");
    });

    it("changes the future task setting without clearing existing caches", async () => {
        const storage = await import("../../src/storage/cache/book-cache");
        const lock = await acquireCacheLock("700");
        await storage.claimBookCache("700", lock.taskId, false);
        await storage.putBookCacheBatchForTask(
            "700",
            lock.taskId,
            new Map([[0, createChapter(0)]]),
            createCacheMeta({ bookId: "700", imageEnabled: false, updatedAt: Date.now() })
        );
        const { createSettingsPanel } = await import("../../src/ui/popups");
        createSettingsPanel();
        const imageSetting = document.querySelector("#esj-settings-images") as HTMLInputElement;

        imageSetting.checked = true;
        imageSetting.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => expect(GM_getValue("enable_image_download", false)).toBe(true));

        expect((await storage.previewBookCache("700", false)).size).toBe(1);
    });

    it.each([
        ["cancelled", "#esj-image-setting-task-confirm-cancel"],
        ["closed with its settings panel", "#esj-settings .esj-common-header button"]
    ])("releases the pending image setting change when %s", async (_case, closeSelector) => {
        listActiveBookDownloadLocks.mockResolvedValue([{ bookId: "701" }, { bookId: "702" }]);
        const { createSettingsPanel } = await import("../../src/ui/popups");
        createSettingsPanel();
        const imageSetting = document.querySelector("#esj-settings-images") as HTMLInputElement;

        imageSetting.checked = true;
        imageSetting.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => expect(document.querySelector("#esj-image-setting-task-confirm")).not.toBeNull());
        (document.querySelector(closeSelector) as HTMLButtonElement).click();

        await vi.waitFor(() => expect(document.querySelector("#esj-image-setting-task-confirm")).toBeNull());
        expect(imageSetting.disabled).toBe(false);
        expect(imageSetting.checked).toBe(false);
        expect(GM_getValue("enable_image_download", false)).toBe(false);
    });
});
