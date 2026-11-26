// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createDownloadHarness } from "../support/download-harness";
import type { Chapter } from "../../src/content/model";
import { createChapter, createDownloadTask } from "../support";
import { createMappedContent } from "../support/mapped-font-fixture";

describe("mapped font cache normalization", () => {
    it("persists normalized mapped chapters and summarizes them before fetching missing chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
        const chapters = new Map<number, Chapter>([
            [0, createChapter(0, { content: createMappedContent() })],
            [1, createChapter(1, { content: createMappedContent({ family: "2" }) })]
        ]);
        const harness = createDownloadHarness(chapters);
        const { ui, dependencies } = harness;
        dependencies.concurrency = 5;
        const writes = vi.spyOn(dependencies.cache, "putBatch");

        await harness.run({
            bookId: "100",
            taskId: "task-100",
            bookName: "Test book",
            introTxt: "Intro\n",
            description: "Description",
            tags: [],
            sourcePageType: "detail",
            imageEnabled: false,
            tasks
        });

        expect(ui.confirmMappingFontDownload).toHaveBeenCalledOnce();
        expect(ui.confirmMappingFontDownload).toHaveBeenCalledWith(
            expect.objectContaining({ task: tasks[0], chapterCount: 2, fontBytes: 128, inFlightLimit: 0 }),
            expect.any(AbortSignal)
        );
        expect(ui.updateMappingFontWarning).toHaveBeenCalledWith({ chapterCount: 2, fontBytes: 128 });
        expect(harness.fetcher.calls.map((task) => task.index)).toEqual([2]);
        const restoredWrites = writes.mock.calls.map(([, , entries]) => entries.get(0)).filter(Boolean);
        expect(restoredWrites).toMatchObject([
            {
                content: expect.not.stringContaining("data:text/css"),
                mappingFont: { family: "1", blob: expect.objectContaining({ size: 64 }) }
            }
        ]);
        expect(harness.exportData?.chapters[0].mappingFont?.family).toBe("1");
    });
});
