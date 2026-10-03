import { describe, expect, it, vi } from "vitest";
import { DownloadProgress } from "../../src/core/download/download-progress";
import { createDownloadScope } from "../../src/core/download/download-scope";
import { createChapter, createDownloadTask } from "../support";

describe("DownloadProgress", () => {
    it("derives both ready counters from selected chapters after additions and invalidation", () => {
        const scope = createDownloadScope(
            {
                bookId: "100",
                taskId: "range-task",
                bookName: "Range book",
                introTxt: "",
                description: "",
                tags: [],
                imageEnabled: false,
                tasks: [createDownloadTask(10), createDownloadTask(11)],
                selection: { mode: "range", sourceTotalChapters: 20, startIndex: 10, endIndex: 11 }
            },
            { currentUrl: () => "https://example.test/book", now: () => 0 }
        );
        const chapters = new Map([
            [0, createChapter(0)],
            [10, createChapter(10)]
        ]);
        const ui = { update: vi.fn() };
        const progress = new DownloadProgress(scope, chapters, { emit: vi.fn() }, ui);
        expect(progress.snapshot).toMatchObject({ readyChapterCount: 1, cachedChapterCount: 1 });

        chapters.set(11, createChapter(11));
        chapters.set(19, createChapter(19));
        progress.update({ processedCount: 1 });
        expect(ui.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ readyChapterCount: 2, cachedChapterCount: 2 })
        );

        chapters.delete(10);
        progress.update({ failedCount: 1 });
        expect(ui.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ readyChapterCount: 1, cachedChapterCount: 1 })
        );
        expect(chapters.size).toBe(3);
    });
});
