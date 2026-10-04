// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createDownloadHarness } from "../support/download-harness";
import type { Chapter } from "../../src/types";
import { createChapter, createDownloadTask } from "../support";

function createWoff2Bytes(): Uint8Array {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x774f4632, false);
    view.setUint32(8, bytes.byteLength, false);
    return bytes;
}

function createLegacyMappedContent(family = "1"): string {
    const dataUrl = `data:font/woff2;base64,${Buffer.from(createWoff2Bytes()).toString("base64")}`;
    const css = `@font-face { font-family: '${family}'; src: url('${dataUrl}') format('woff2'); }`;
    return `<link rel="stylesheet" href="data:text/css,${encodeURIComponent(css)}"><section style="font-family: '${family}', sans-serif;"><p>Mapped body</p></section>`;
}

describe("mapped font cache normalization", () => {
    it("writes normalized font and content in one batch without refetching", async () => {
        const task = createDownloadTask();
        const chapters = new Map<number, Chapter>([[0, createChapter(0, { content: createLegacyMappedContent() })]]);
        const writes: Map<number, Chapter>[] = [];
        const harness = createDownloadHarness([task], chapters);
        const { ui, dependencies } = harness;
        dependencies.chapterFetcher = { fetch: vi.fn(async () => "") };
        dependencies.cache.putBatch = async (_bookId, _taskId, entries) => {
            writes.push(new Map(entries));
            return true;
        };

        await harness.run({
            bookId: "100",
            taskId: "task-100",
            bookName: "Test book",
            introTxt: "Intro\n",
            description: "Description",
            tags: [],
            sourcePageType: "detail",
            imageEnabled: false,
            tasks: [task]
        });

        expect(dependencies.chapterFetcher.fetch).not.toHaveBeenCalled();
        expect(ui.confirmMappingFontDownload).toHaveBeenCalledOnce();
        expect(writes).toHaveLength(1);
        expect(writes[0].get(0)?.mappingFont?.blob.size).toBe(64);
        expect(writes[0].get(0)?.content).not.toContain("data:text/css");
        expect(harness.exportData?.chapters[0].mappingFont?.family).toBe("1");
    });

    it("summarizes all restored mapped chapters before consent and fetches only missing chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
        const chapters = new Map<number, Chapter>([
            [0, createChapter(0, { content: createLegacyMappedContent("1") })],
            [1, createChapter(1, { content: createLegacyMappedContent("2") })]
        ]);
        const fetchedIndexes: number[] = [];
        const harness = createDownloadHarness(tasks, chapters);
        const { ui, dependencies } = harness;
        dependencies.chapterFetcher = {
            fetch: vi.fn(async (task) => {
                fetchedIndexes.push(task.index);
                return `<p>${task.title}</p>`;
            })
        };
        dependencies.concurrency = 5;

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
        expect(fetchedIndexes).toEqual([2]);
    });
});
