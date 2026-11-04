// @vitest-environment jsdom

import { expect, it, vi } from "vitest";
import type { CacheClearResult } from "../../src/app/cache-management";
import { createDeferred } from "../support";

it("keeps the current batch clear error when an older cache manager finishes later", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const manager = await import("../../src/app/cache-management");
    const { createCacheManagerPopup } = await import("../../src/ui/dialogs/cache-manager");
    const { fullCleanup } = await import("../../src/ui/dom");
    const oldClear = createDeferred<CacheClearResult>();
    const started = createDeferred<void>();
    vi.spyOn(manager, "listManagedCaches").mockResolvedValue([]);
    vi.spyOn(manager, "clearAllManagedCaches")
        .mockImplementationOnce(() => {
            started.resolve();
            return oldClear.promise;
        })
        .mockRejectedValueOnce(new Error("current store failure"));

    async function confirmBatchClear() {
        createCacheManagerPopup();
        const clear = await vi.waitFor(() => {
            const button = document.querySelector<HTMLButtonElement>("#esj-cache-manager .esj-cache-action-danger");
            if (!button) {
                throw new Error("missing batch clear action");
            }
            return button;
        });
        clear.click();
        document.querySelector<HTMLButtonElement>("#esj-cache-confirm-ok")!.click();
    }

    try {
        await confirmBatchClear();
        await started.promise;
        await confirmBatchClear();
        await vi.waitFor(() =>
            expect(document.querySelector("#esj-message-details")?.textContent).toBe("current store failure")
        );
        const currentMessage = document.querySelector("#esj-message-popup");

        oldClear.reject(new Error("stale store failure"));
        await expect(oldClear.promise).rejects.toThrow("stale store failure");
        expect(document.querySelector("#esj-message-popup")).toBe(currentMessage);
    } finally {
        fullCleanup();
    }
});
