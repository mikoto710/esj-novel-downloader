// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookLock, createChapter, createDeferred, createDownloadTask, useFakeClock } from "./support";

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    sleepWithAbort: vi.fn(),
    sleep: vi.fn(),
    fetchWithTimeout: vi.fn(),
    fullCleanup: vi.fn(),
    createDownloadPopup: vi.fn(),
    showFormatChoice: vi.fn(),
    updateTrayText: vi.fn(),
    saveCache: vi.fn(),
    clearCache: vi.fn(),
    getConcurrency: vi.fn(),
    getImageDownloadSetting: vi.fn(),
    processHtmlImages: vi.fn(),
    parseChapterHtml: vi.fn(),
    ownsLock: vi.fn(),
    shouldDiscard: vi.fn()
}));

vi.mock("../src/core/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: vi.fn()
}));
vi.mock("../src/utils/index", () => ({
    log: mocks.log,
    sleepWithAbort: mocks.sleepWithAbort,
    sleep: mocks.sleep,
    fetchWithTimeout: mocks.fetchWithTimeout
}));
vi.mock("../src/utils/dom", () => ({ fullCleanup: mocks.fullCleanup }));
vi.mock("../src/ui/popups", () => ({
    createDownloadPopup: mocks.createDownloadPopup,
    showFormatChoice: mocks.showFormatChoice
}));
vi.mock("../src/ui/tray", () => ({ updateTrayText: mocks.updateTrayText }));
vi.mock("../src/core/cache/book-cache", () => ({
    putBookCacheBatchForTask: mocks.saveCache,
    clearBookCacheForTask: mocks.clearCache
}));
vi.mock("../src/core/config", () => ({
    getConcurrency: mocks.getConcurrency,
    getImageDownloadSetting: mocks.getImageDownloadSetting
}));
vi.mock("../src/utils/image", () => ({ processHtmlImages: mocks.processHtmlImages }));
vi.mock("../src/core/parser", () => ({ parseChapterHtml: mocks.parseChapterHtml }));
vi.mock("../src/core/book-lock", () => ({
    ownsActiveBookDownloadLock: mocks.ownsLock,
    shouldDiscardBookDownloadCache: mocks.shouldDiscard
}));

import { batchDownload } from "../src/core/download/batch-download";
import { abortActiveDownload, resetAbortController, setAbortFlag, state } from "../src/core/state";

describe("downloader contracts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
        document.title = "ESJZone Test";
        state.originalTitle = document.title;
        state.cachedData = null;
        state.globalChaptersMap = new Map();
        state.runtimeCacheSession = null;
        state.activeBookLock = createBookLock({ status: "running" });
        setAbortFlag(false);
        resetAbortController();

        mocks.log.mockImplementation(() => undefined);
        mocks.sleepWithAbort.mockResolvedValue(undefined);
        mocks.sleep.mockResolvedValue(undefined);
        mocks.fetchWithTimeout.mockResolvedValue({ text: vi.fn().mockResolvedValue("<html></html>") });
        mocks.createDownloadPopup.mockImplementation(() => document.createElement("div"));
        mocks.saveCache.mockResolvedValue(true);
        mocks.clearCache.mockResolvedValue(true);
        mocks.getConcurrency.mockReturnValue(1);
        mocks.getImageDownloadSetting.mockReturnValue(false);
        mocks.parseChapterHtml.mockImplementation((_html: string, title: string) => ({
            title,
            author: "",
            contentHtml: "<p>正文</p>",
            contentText: "正文",
            bookName: "测试小说"
        }));
        mocks.ownsLock.mockResolvedValue(true);
        mocks.shouldDiscard.mockResolvedValue(false);
    });

    it("does not fetch chapters already restored from cache", async () => {
        const tasks = Array.from({ length: 3 }, (_, index) => createDownloadTask(index));
        state.globalChaptersMap = new Map(tasks.map((task) => [task.index, createChapter(task.index)]));

        await batchDownload(createOptions(tasks));

        expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
        expect(mocks.saveCache).not.toHaveBeenCalled();
        expect(mocks.clearCache).toHaveBeenCalledOnce();
        expect(state.cachedData?.chapters).toHaveLength(3);
        expect(mocks.showFormatChoice).toHaveBeenCalledOnce();
    });

    it("passes the active abort signal to coordinator delays", async () => {
        await batchDownload(createOptions(createTasks(1)));

        expect(mocks.sleepWithAbort).toHaveBeenCalled();
        expect(mocks.sleepWithAbort.mock.calls.every((call) => call[1] === state.abortController?.signal)).toBe(true);
    });

    it("shows saving, integrity, export preparation, and completion stages", async () => {
        await batchDownload(createOptions(createTasks(1)));

        const trayMessages = mocks.updateTrayText.mock.calls.flat();
        expect(trayMessages).toContain("正在保存下载进度 (1/1)");
        expect(trayMessages).toContain("正在检查章节完整性 (1/1)");
        expect(trayMessages).toContain("正在准备导出 (1/1)");
        expect(trayMessages).toContain("下载完成 (1/1)");
    });

    it("applies cache backpressure before a worker claims another chapter", async () => {
        const writeStarted = createDeferred<void>();
        const writeFinished = createDeferred<boolean>();
        mocks.saveCache
            .mockImplementationOnce(() => {
                writeStarted.resolve();
                return writeFinished.promise;
            })
            .mockResolvedValue(true);

        const downloadPromise = batchDownload(createOptions(createTasks(26)));
        await writeStarted.promise;

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(25);
        writeFinished.resolve(true);
        await downloadPromise;
        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(26);
    });

    it("retries a missing chapter through the integrity queue", async () => {
        mocks.fetchWithTimeout
            .mockRejectedValueOnce(new Error("first"))
            .mockRejectedValueOnce(new Error("second"))
            .mockRejectedValueOnce(new Error("third"))
            .mockResolvedValue({ text: vi.fn().mockResolvedValue("<html></html>") });

        await batchDownload(createOptions(createTasks(1)));

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(4);
        expect(mocks.saveCache).toHaveBeenCalledOnce();
        expect(state.cachedData?.chapters).toHaveLength(1);
    });

    it("does not fetch another chapter after cancellation reaches the retry queue", async () => {
        mocks.fetchWithTimeout.mockRejectedValue(new Error("network"));
        mocks.log.mockImplementation((message: string) => {
            if (message.startsWith("补抓 [")) {
                abortActiveDownload();
            }
        });

        await batchDownload(createOptions(createTasks(1)));

        expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(3);
        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
        expect(mocks.fullCleanup).toHaveBeenCalledOnce();
    });

    it("does not persist a chapter cancelled during image processing", async () => {
        mocks.getImageDownloadSetting.mockReturnValue(true);
        mocks.processHtmlImages.mockImplementationOnce(async () => {
            abortActiveDownload();
            return { processedHtml: "<p>未完成正文</p>", images: [], failCount: 0 };
        });

        await batchDownload(createOptions(createTasks(1)));

        expect(state.globalChaptersMap.size).toBe(0);
        expect(mocks.saveCache).not.toHaveBeenCalled();
        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
    });

    it("aborts cache cleanup when cancellation arrives during export preparation", async () => {
        const clearStarted = createDeferred<void>();
        const clearAborted = createDeferred<void>();
        mocks.clearCache.mockImplementationOnce((_bookId, _taskId, signal?: AbortSignal) => {
            clearStarted.resolve();
            return new Promise<boolean>((resolve) => {
                signal?.addEventListener(
                    "abort",
                    () => {
                        clearAborted.resolve();
                        resolve(false);
                    },
                    { once: true }
                );
            });
        });

        const downloadPromise = batchDownload(createOptions(createTasks(1)));
        await clearStarted.promise;
        abortActiveDownload();

        await clearAborted.promise;
        await downloadPromise;

        expect(mocks.showFormatChoice).not.toHaveBeenCalled();
        expect(mocks.log.mock.calls.flat().join("\n")).toContain("进度已保存");
    });

    it("bounds cancellation while a cache write is pending", async () => {
        const clock = useFakeClock();
        const saveStarted = createDeferred<void>();
        const blockedSave = createDeferred<boolean>();
        mocks.saveCache
            .mockImplementationOnce((_bookId, _taskId, _entries, _meta, signal?: AbortSignal) => {
                saveStarted.resolve();
                signal?.addEventListener("abort", () => blockedSave.resolve(false), { once: true });
                return blockedSave.promise;
            })
            .mockResolvedValue(true);
        const downloadPromise = batchDownload(createOptions(createTasks(5)));
        await saveStarted.promise;
        abortActiveDownload();
        abortActiveDownload();

        try {
            const outcome = Promise.race([
                downloadPromise.then(() => "settled" as const),
                new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 6_000))
            ]);
            await clock.advanceBy(6_000);
            await expect(outcome).resolves.toBe("settled");
            expect(mocks.saveCache).toHaveBeenCalledOnce();
            expect(mocks.fullCleanup).toHaveBeenCalledOnce();
            expect(mocks.log.mock.calls.flat().join("\n")).toContain("进度保存超时");
        } finally {
            blockedSave.resolve(true);
            await downloadPromise;
            clock.restore();
        }
    });

    it("aborts the active cache write immediately when cancellation discards progress", async () => {
        const saveStarted = createDeferred<void>();
        const writeAborted = createDeferred<void>();
        document.body.innerHTML = '<span id="esj-title"></span><button id="esj-cancel"></button>';
        mocks.saveCache.mockImplementationOnce((_bookId, _taskId, _entries, _meta, signal?: AbortSignal) => {
            saveStarted.resolve();
            return new Promise<boolean>((resolve) => {
                signal?.addEventListener(
                    "abort",
                    () => {
                        writeAborted.resolve();
                        resolve(false);
                    },
                    { once: true }
                );
            });
        });
        mocks.shouldDiscard.mockResolvedValue(true);

        const downloadPromise = batchDownload(createOptions(createTasks(5)));
        await saveStarted.promise;
        abortActiveDownload();
        abortActiveDownload("discard");

        await writeAborted.promise;
        await downloadPromise;

        expect(mocks.saveCache).toHaveBeenCalledOnce();
        expect(mocks.log.mock.calls.flat().join("\n")).toContain("正在清理缓存");
        expect(document.querySelector("#esj-title")?.textContent).toBe("📘 任务已停止");
        expect(document.querySelector("#esj-cancel")?.textContent).toBe("已停止");
    });

    it("does not repeat a whole-book save after cancellation", async () => {
        mocks.saveCache.mockImplementationOnce(async () => {
            abortActiveDownload();
            return true;
        });

        await batchDownload(createOptions(createTasks(5)));

        expect(mocks.saveCache).toHaveBeenCalledTimes(1);
    });

    it("does not claim that progress was saved after storage rejected the write", async () => {
        mocks.saveCache.mockResolvedValue(false);

        await batchDownload(createOptions(createTasks(5)));

        const messages = mocks.log.mock.calls.flat().join("\n");
        expect(messages).not.toContain("进度已保存");
    });
});

function createTasks(count: number) {
    return Array.from({ length: count }, (_, index) => createDownloadTask(index));
}

function createOptions(tasks: ReturnType<typeof createDownloadTask>[]) {
    return {
        bookId: "100",
        taskId: "task-100",
        bookName: "测试小说",
        rawBookName: "测试小说",
        author: "测试作者",
        introTxt: "测试简介\n",
        description: "测试描述",
        tags: [],
        pageUrl: "https://www.esjzone.cc/detail/100.html",
        sourcePageType: "detail" as const,
        tasks
    };
}
