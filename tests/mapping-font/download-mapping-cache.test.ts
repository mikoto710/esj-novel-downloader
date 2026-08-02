// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { runDownload } from "../../src/core/download/coordinator";
import type { DownloadDependencies } from "../../src/core/download/contracts";
import type { CachedData, Chapter } from "../../src/types";
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
    it("extracts and atomically writes back a legacy embedded font without refetching", async () => {
        const task = createDownloadTask();
        const chapters = new Map<number, Chapter>([[0, createChapter(0, { content: createLegacyMappedContent() })]]);
        const writes: Map<number, Chapter>[] = [];
        let exportData: CachedData | null = null;
        const ui = {
            prepare: vi.fn(),
            update: vi.fn(),
            confirmMappingFontDownload: vi.fn(async () => true),
            updateMappingFontWarning: vi.fn(),
            showMappingFontFailure: vi.fn(),
            cleanup: vi.fn(),
            showFormatChoice: vi.fn()
        };
        const dependencies: DownloadDependencies = {
            runtime: {
                chapters,
                signal: new AbortController().signal,
                activeBookLock: null,
                originalTitle: "Test",
                isCancellationRequested: () => false,
                requestCancellation: vi.fn(),
                subscribeCancellation: () => () => undefined,
                startCacheSession: vi.fn(),
                updateCacheSession: vi.fn(),
                setExportData(data) {
                    exportData = data;
                }
            },
            ui,
            chapterFetcher: { fetch: vi.fn(async () => "") },
            chapterProcessor: { process: vi.fn(async () => createChapter()) },
            coverFetcher: { fetch: async () => null },
            coverCache: { load: async () => null, put: async () => true },
            cache: {
                async putBatch(_bookId, _taskId, entries) {
                    writes.push(new Map(entries));
                    return true;
                },
                clearForTask: async () => true
            },
            lock: { owns: async () => true, shouldDiscardCache: async () => false },
            events: { emit: () => undefined },
            scheduler: {
                sleep: async () => undefined,
                sleepWithAbort: async () => undefined,
                randomDelay: () => 0,
                schedule: () => () => undefined
            },
            settings: { getConcurrency: () => 1, isImageDownloadEnabled: () => false },
            environment: {
                currentUrl: () => "https://www.esjzone.cc/detail/100.html",
                now: () => Date.parse("2026-01-01T00:00:00.000Z")
            },
            log: vi.fn()
        };

        await runDownload(
            {
                bookId: "100",
                taskId: "task-100",
                bookName: "Test book",
                introTxt: "Intro\n",
                description: "Description",
                tags: [],
                sourcePageType: "detail",
                tasks: [task]
            },
            dependencies
        );

        expect(dependencies.chapterFetcher.fetch).not.toHaveBeenCalled();
        expect(ui.confirmMappingFontDownload).toHaveBeenCalledOnce();
        expect(writes).toHaveLength(1);
        expect(writes[0].get(0)?.mappingFont?.blob.size).toBe(64);
        expect(writes[0].get(0)?.content).not.toContain("data:text/css");
        expect((exportData as CachedData | null)?.chapters[0].mappingFont?.family).toBe("1");
    });

    it("summarizes all restored mapped chapters before consent and fetches only missing chapters", async () => {
        const tasks = [createDownloadTask(0), createDownloadTask(1), createDownloadTask(2)];
        const chapters = new Map<number, Chapter>([
            [0, createChapter(0, { content: createLegacyMappedContent("1") })],
            [1, createChapter(1, { content: createLegacyMappedContent("2") })]
        ]);
        const fetchedIndexes: number[] = [];
        const ui = {
            prepare: vi.fn(),
            update: vi.fn(),
            confirmMappingFontDownload: vi.fn(async () => true),
            updateMappingFontWarning: vi.fn(),
            showMappingFontFailure: vi.fn(),
            cleanup: vi.fn(),
            showFormatChoice: vi.fn()
        };
        const dependencies: DownloadDependencies = {
            runtime: {
                chapters,
                signal: new AbortController().signal,
                activeBookLock: null,
                originalTitle: "Test",
                isCancellationRequested: () => false,
                requestCancellation: vi.fn(),
                subscribeCancellation: () => () => undefined,
                startCacheSession: vi.fn(),
                updateCacheSession: vi.fn(),
                setExportData: vi.fn()
            },
            ui,
            chapterFetcher: {
                fetch: vi.fn(async (task) => {
                    fetchedIndexes.push(task.index);
                    return `<p>${task.title}</p>`;
                })
            },
            chapterProcessor: {
                process: vi.fn(async (_html, task) => createChapter(task.index))
            },
            coverFetcher: { fetch: async () => null },
            coverCache: { load: async () => null, put: async () => true },
            cache: { putBatch: async () => true, clearForTask: async () => true },
            lock: { owns: async () => true, shouldDiscardCache: async () => false },
            events: { emit: () => undefined },
            scheduler: {
                sleep: async () => undefined,
                sleepWithAbort: async () => undefined,
                randomDelay: () => 0,
                schedule: () => () => undefined
            },
            settings: { getConcurrency: () => 5, isImageDownloadEnabled: () => false },
            environment: {
                currentUrl: () => "https://www.esjzone.cc/detail/100.html",
                now: () => Date.parse("2026-01-01T00:00:00.000Z")
            },
            log: vi.fn()
        };

        await runDownload(
            {
                bookId: "100",
                taskId: "task-100",
                bookName: "Test book",
                introTxt: "Intro\n",
                description: "Description",
                tags: [],
                sourcePageType: "detail",
                tasks
            },
            dependencies
        );

        expect(ui.confirmMappingFontDownload).toHaveBeenCalledOnce();
        expect(ui.confirmMappingFontDownload).toHaveBeenCalledWith(
            expect.objectContaining({ task: tasks[0], chapterCount: 2, fontBytes: 128, inFlightLimit: 0 })
        );
        expect(ui.updateMappingFontWarning).toHaveBeenCalledWith({ chapterCount: 2, fontBytes: 128 });
        expect(fetchedIndexes).toEqual([2]);
    });
});
