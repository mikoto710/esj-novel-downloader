// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as locks from "../../src/storage/book-lock";
import { state } from "../../src/app/page-session";
import { createSettingsPanel } from "../../src/ui/dialogs/settings";
import { fullCleanup } from "../../src/utils/dom";
import { createCachedData } from "../support";
import { getUserscriptApiMocks } from "../support/gm";

describe("settings storage failures", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(locks, "listActiveBookDownloadLocks").mockResolvedValue([]);
        state.cachedData = createCachedData({ epubBlob: new Blob(["previous export"]) });
    });

    afterEach(() => {
        fullCleanup();
        state.cachedData = null;
    });

    it.each([
        { id: "esj-interface-language", key: "interface_locale_preference", previous: "auto", next: "zh-TW" },
        { id: "esj-settings-concurrency", key: "concurrency", previous: 5, next: 3 },
        { id: "esj-settings-images", key: "enable_image_download", previous: false, next: true },
        { id: "esj-settings-epub-tag-page", key: "enable_epub_tag_page", previous: false, next: true }
    ])("restores $id when its preference cannot be saved", async ({ id, key, previous, next }) => {
        const gm = getUserscriptApiMocks();
        gm.values.set(key, previous);
        createSettingsPanel();
        const previousExport = state.cachedData?.epubBlob;
        gm.setValue.mockImplementation((storedKey: string, value: unknown) => {
            if (storedKey === key) throw new Error("GM write unavailable");
            gm.values.set(storedKey, value);
        });
        const control = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
        if (typeof next === "boolean" && control instanceof HTMLInputElement) control.checked = next;
        else control.value = String(next);
        control.dispatchEvent(new Event(id === "esj-settings-concurrency" ? "input" : "change", { bubbles: true }));

        await vi.waitFor(() => {
            if (typeof previous === "boolean" && control instanceof HTMLInputElement) {
                expect(control.checked).toBe(previous);
            } else {
                expect(control.value).toBe(String(previous));
            }
            expect(control.disabled).toBe(false);
            expect(document.querySelector("#esj-message-popup")).not.toBeNull();
        });
        expect(gm.values.get(key)).toBe(previous);
        expect(state.cachedData?.epubBlob).toBe(previousExport);
    });

    it.each(["preference-read", "lock-read"] as const)(
        "restores the image preference after %s failure before saving",
        async (stage) => {
            const gm = getUserscriptApiMocks();
            gm.values.set("enable_image_download", true);
            createSettingsPanel();
            if (stage === "preference-read") {
                gm.getValue.mockImplementation((key: string, fallback?: unknown) => {
                    if (key === "enable_image_download") throw new Error("GM read unavailable");
                    return gm.values.has(key) ? gm.values.get(key) : fallback;
                });
            } else {
                vi.mocked(locks.listActiveBookDownloadLocks).mockRejectedValue(new Error("lock read unavailable"));
            }
            const input = document.querySelector<HTMLInputElement>("#esj-settings-images")!;
            input.checked = false;
            input.dispatchEvent(new Event("change", { bubbles: true }));

            await vi.waitFor(() => {
                expect(input.checked).toBe(true);
                expect(input.disabled).toBe(false);
            });
            expect(gm.values.get("enable_image_download")).toBe(true);
        }
    );
});
