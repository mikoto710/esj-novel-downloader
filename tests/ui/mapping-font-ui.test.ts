// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { confirmIncompleteChapters, confirmMappingFontDownload } from "../../src/ui/popups";
import { createDownloadTask } from "../support";

describe("mapping font confirmation cancellation", () => {
    it("closes as rejection when the task signal aborts", async () => {
        const controller = new AbortController();
        const confirmation = confirmMappingFontDownload(
            { task: createDownloadTask(), chapterCount: 1, fontBytes: 64, inFlightLimit: 1 },
            controller.signal
        );

        controller.abort();

        await expect(confirmation).resolves.toBe(false);
        expect(document.querySelector("#esj-mapping-confirm")).toBeNull();
    });
});

describe("incomplete chapter decision cancellation", () => {
    it("closes as cancellation when the download signal aborts", async () => {
        const controller = new AbortController();
        const decision = confirmIncompleteChapters(
            { missingTasks: [createDownloadTask()], totalChapters: 1 },
            controller.signal
        );

        controller.abort();

        await expect(decision).resolves.toBe("cancel");
        expect(document.querySelector("#esj-incomplete-chapters")).toBeNull();
    });
});
