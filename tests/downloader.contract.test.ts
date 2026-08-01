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

// 下面的 it.fails 用例是已确认缺陷的可执行目标契约
// 对应行为修复后移除 .fails，转为普通回归测试
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

    it.fails("bounds cancellation while a cache write is pending", async () => {
        const clock = useFakeClock();
        const saveStarted = createDeferred<void>();
        const blockedSave = createDeferred<boolean>();
        mocks.saveCache
            .mockImplementationOnce(() => {
                saveStarted.resolve();
                return blockedSave.promise;
            })
            .mockResolvedValue(true);
        const downloadPromise = batchDownload(createOptions(createTasks(5)));
        await saveStarted.promise;
        abortActiveDownload();

        try {
            const outcome = Promise.race([
                downloadPromise.then(() => "settled" as const),
                new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 6_000))
            ]);
            await clock.advanceBy(6_000);
            await expect(outcome).resolves.toBe("settled");
        } finally {
            blockedSave.resolve(true);
            await downloadPromise;
            clock.restore();
        }
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
