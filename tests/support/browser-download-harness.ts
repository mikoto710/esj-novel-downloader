import { expect, vi } from "vitest";
import type { DownloadResult, ProtectedChapterDecision } from "../../src/download/contracts";
import { createBookLock, createDownloadTask } from "./factories";
import { createSelectionPopupFake } from "./fakes";

const hoistedBrowserDownloadMocks = vi.hoisted(() => ({
    log: vi.fn(),
    sleepWithAbort: vi.fn(),
    sleep: vi.fn(),
    fetchWithTimeout: vi.fn(),
    fullCleanup: vi.fn(),
    createDownloadPopup: vi.fn(),
    confirmMappingFontDownload: vi.fn(async () => true),
    confirmIncompleteChapters: vi.fn(async () => "export-with-placeholders" as const),
    promptProtectedChapterPassword: vi.fn(async (): Promise<ProtectedChapterDecision> => ({ action: "skip-current" })),
    closeProtectedChapterPrompt: vi.fn(),
    updateMappingFontWarning: vi.fn(),
    showMappingFontFailure: vi.fn(),
    showTerminalFailure: vi.fn(),
    updateTrayText: vi.fn(),
    saveCache: vi.fn(),
    finishCache: vi.fn(),
    clearCache: vi.fn(),
    loadCoverCache: vi.fn(),
    saveCoverCache: vi.fn(),
    getConcurrency: vi.fn(),
    getInterfaceLocalePreference: vi.fn(),
    processHtmlImages: vi.fn(),
    parseChapterHtml: vi.fn(),
    ownsLock: vi.fn(),
    shouldDiscard: vi.fn(),
    runDownload: vi.fn(),
    release: vi.fn(),
    stopHeartbeat: vi.fn(),
    startHeartbeat: vi.fn(),
    getConflict: vi.fn(),
    acquire: vi.fn(),
    markRunning: vi.fn(),
    updateTitle: vi.fn(),
    previewCache: vi.fn(),
    claimCache: vi.fn(),
    selectionPopup: vi.fn(),
    selectionView: vi.fn(),
    showFormatChoice: vi.fn(),
    showCacheDiscardFailure: vi.fn(),
    getImageDownloadSetting: vi.fn()
}));

export function getBrowserDownloadMocks() {
    return hoistedBrowserDownloadMocks;
}

vi.mock("../../src/download/run", () => ({ runDownload: hoistedBrowserDownloadMocks.runDownload }));
vi.mock("../../src/ui/dialogs/download-selection", () => ({
    createDownloadSelectionPopup: hoistedBrowserDownloadMocks.selectionView
}));
vi.mock("../../src/ui/dialogs/message", () => ({ showMessagePopup: vi.fn() }));
vi.mock("../../src/storage/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: vi.fn()
}));
vi.mock("../../src/ui/log-view", () => ({ log: hoistedBrowserDownloadMocks.log }));
vi.mock("../../src/browser/timing", () => ({
    sleepWithAbort: hoistedBrowserDownloadMocks.sleepWithAbort,
    sleep: hoistedBrowserDownloadMocks.sleep
}));
vi.mock("../../src/browser/request", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/browser/request")>()),
    fetchWithTimeout: hoistedBrowserDownloadMocks.fetchWithTimeout
}));
vi.mock("../../src/ui/dom", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/ui/dom")>()),
    fullCleanup: hoistedBrowserDownloadMocks.fullCleanup
}));
vi.mock("../../src/ui/popups", () => ({
    createDownloadPopup: hoistedBrowserDownloadMocks.createDownloadPopup,
    showFormatChoice: hoistedBrowserDownloadMocks.showFormatChoice,
    showBookDownloadInProgressPopup: vi.fn(),
    confirmMappingFontDownload: hoistedBrowserDownloadMocks.confirmMappingFontDownload,
    confirmIncompleteChapters: hoistedBrowserDownloadMocks.confirmIncompleteChapters,
    promptProtectedChapterPassword: hoistedBrowserDownloadMocks.promptProtectedChapterPassword,
    closeProtectedChapterPrompt: hoistedBrowserDownloadMocks.closeProtectedChapterPrompt,
    updateMappingFontWarning: hoistedBrowserDownloadMocks.updateMappingFontWarning,
    showMappingFontFailure: hoistedBrowserDownloadMocks.showMappingFontFailure
}));
vi.mock("../../src/ui/messages/download-terminal", () => ({
    showCacheDiscardFailure: hoistedBrowserDownloadMocks.showCacheDiscardFailure,
    showDownloadTerminalFailure: hoistedBrowserDownloadMocks.showTerminalFailure
}));
vi.mock("../../src/ui/tray", () => ({ updateTrayText: hoistedBrowserDownloadMocks.updateTrayText }));
vi.mock("../../src/storage/cache/book-cache", () => ({
    previewBookCache: hoistedBrowserDownloadMocks.previewCache,
    claimBookCache: hoistedBrowserDownloadMocks.claimCache,
    putBookCacheBatchForTask: hoistedBrowserDownloadMocks.saveCache,
    finishBookCacheForTask: hoistedBrowserDownloadMocks.finishCache,
    clearBookCacheForTask: hoistedBrowserDownloadMocks.clearCache,
    loadBookCover: hoistedBrowserDownloadMocks.loadCoverCache,
    putBookCoverForTask: hoistedBrowserDownloadMocks.saveCoverCache
}));
vi.mock("../../src/storage/settings", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/storage/settings")>()),
    getImageDownloadSetting: hoistedBrowserDownloadMocks.getImageDownloadSetting,
    getConcurrency: hoistedBrowserDownloadMocks.getConcurrency,
    getInterfaceLocalePreference: hoistedBrowserDownloadMocks.getInterfaceLocalePreference
}));
vi.mock("../../src/site/images", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/site/images")>()),
    processHtmlImages: hoistedBrowserDownloadMocks.processHtmlImages
}));
vi.mock("../../src/site/chapter", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/site/chapter")>()),
    parseChapterHtml: hoistedBrowserDownloadMocks.parseChapterHtml
}));
vi.mock("../../src/storage/book-lock", () => ({
    acquireBookDownloadLock: hoistedBrowserDownloadMocks.acquire,
    getConflictingBookDownloadLock: hoistedBrowserDownloadMocks.getConflict,
    markBookDownloadRunning: hoistedBrowserDownloadMocks.markRunning,
    startBookDownloadLockHeartbeat: hoistedBrowserDownloadMocks.startHeartbeat,
    updateBookDownloadLockTitle: hoistedBrowserDownloadMocks.updateTitle,
    releaseBookDownloadLock: hoistedBrowserDownloadMocks.release,
    ownsActiveBookDownloadLock: hoistedBrowserDownloadMocks.ownsLock,
    shouldDiscardBookDownloadCache: hoistedBrowserDownloadMocks.shouldDiscard
}));

/**
 * 下载应用测试的运行入口、任务资源及依赖替身
 */
export interface BrowserDownloadRuntime {
    runBookDownload(options: import("../../src/download/contracts").DownloadOptions): Promise<DownloadResult>;
    task: {
        lock: import("../../src/storage/book-lock").BookDownloadLock;
        chapters: Map<number, import("../../src/content/model").Chapter>;
        readonly cancellation: import("../../src/download/contracts").DownloadCancellationPort & {
            readonly mode: import("../../src/download/contracts").DownloadCancellationMode;
        };
    };
    start(options: import("../../src/download/contracts").DownloadOptions): Promise<void>;
    readonly dependencies: import("../../src/download/contracts").DownloadDependencies;
    abortActiveDownload: typeof import("../../src/app/page-session").abortActiveDownload;
    state: typeof import("../../src/app/page-session").state;
}

export async function resetBrowserDownloadHarness(): Promise<BrowserDownloadRuntime> {
    const [{ runBookDownload }, stateRuntime] = await Promise.all([
        import("../../src/app/book-download"),
        import("../../src/app/page-session")
    ]);
    const { abortActiveDownload, state } = stateRuntime;
    vi.clearAllMocks();
    document.body.innerHTML = "";
    document.title = "ESJZone Test";
    state.originalTitle = document.title;
    state.cachedData = null;
    state.runtimeCacheSession = null;
    state.activeDownload = null;
    const task = {
        lock: createBookLock({ status: "running" }),
        chapters: new Map<number, import("../../src/content/model").Chapter>(),
        get cancellation() {
            return hoistedBrowserDownloadMocks.runDownload.mock.calls.at(-1)![1].cancellation;
        }
    };
    const actual = await vi.importActual<typeof import("../../src/download/run")>("../../src/download/run");
    hoistedBrowserDownloadMocks.runDownload.mockImplementation(actual.runDownload);
    hoistedBrowserDownloadMocks.selectionView.mockImplementation((options) =>
        createSelectionPopupFake(options, hoistedBrowserDownloadMocks.selectionPopup)
    );
    hoistedBrowserDownloadMocks.getConflict.mockResolvedValue(null);
    hoistedBrowserDownloadMocks.acquire.mockResolvedValue({ acquired: true, lock: task.lock });
    hoistedBrowserDownloadMocks.markRunning.mockResolvedValue(true);
    hoistedBrowserDownloadMocks.startHeartbeat.mockReturnValue(hoistedBrowserDownloadMocks.stopHeartbeat);
    hoistedBrowserDownloadMocks.stopHeartbeat.mockReset();
    hoistedBrowserDownloadMocks.release.mockReset().mockResolvedValue(undefined);
    hoistedBrowserDownloadMocks.previewCache.mockResolvedValue({
        valid: true,
        size: 0,
        indexes: [],
        compatibility: "compatible"
    });
    hoistedBrowserDownloadMocks.claimCache.mockImplementation(async () => ({
        status: "claimed",
        map: task.chapters,
        size: task.chapters.size,
        compatibility: "compatible",
        invalidatedCount: 0
    }));

    hoistedBrowserDownloadMocks.log.mockImplementation(() => undefined);
    hoistedBrowserDownloadMocks.sleepWithAbort.mockResolvedValue(undefined);
    hoistedBrowserDownloadMocks.sleep.mockResolvedValue(undefined);
    hoistedBrowserDownloadMocks.fetchWithTimeout.mockResolvedValue({
        text: vi.fn().mockResolvedValue("<html></html>")
    });
    hoistedBrowserDownloadMocks.createDownloadPopup.mockImplementation(() => document.createElement("div"));
    hoistedBrowserDownloadMocks.promptProtectedChapterPassword.mockResolvedValue({ action: "skip-current" });
    hoistedBrowserDownloadMocks.saveCache.mockResolvedValue(true);
    hoistedBrowserDownloadMocks.finishCache.mockResolvedValue(true);
    hoistedBrowserDownloadMocks.clearCache.mockResolvedValue(true);
    hoistedBrowserDownloadMocks.loadCoverCache.mockResolvedValue(null);
    hoistedBrowserDownloadMocks.saveCoverCache.mockResolvedValue(true);
    hoistedBrowserDownloadMocks.getConcurrency.mockReturnValue(1);
    hoistedBrowserDownloadMocks.getInterfaceLocalePreference.mockReturnValue("zh-CN");
    hoistedBrowserDownloadMocks.parseChapterHtml.mockImplementation((_html: string, title: string) => ({
        title,
        author: "",
        contentHtml: "<p>正文</p>",
        contentText: "正文",
        bookName: "测试小说"
    }));
    hoistedBrowserDownloadMocks.ownsLock.mockResolvedValue(true);
    hoistedBrowserDownloadMocks.shouldDiscard.mockResolvedValue(false);
    const start = (options: import("../../src/download/contracts").DownloadOptions) => {
        hoistedBrowserDownloadMocks.getImageDownloadSetting.mockReturnValue(options.imageEnabled);
        hoistedBrowserDownloadMocks.selectionPopup.mockResolvedValue({
            action: "download",
            selection: options.selection || {
                mode: "all",
                sourceTotalChapters: options.tasks.length,
                startIndex: 0,
                endIndex: options.tasks.length - 1
            }
        });
        return runBookDownload({
            bookId: options.bookId,
            sourcePageType: "detail",
            pageTitle: document.title,
            loadPlan: async () => ({
                tasks: options.tasks,
                pageUrl: options.pageUrl!,
                meta: {
                    bookName: options.bookName,
                    rawBookName: options.rawBookName || options.bookName,
                    author: options.author || "",
                    introTxt: options.introTxt,
                    baseIntroTxt: options.introTxt,
                    description: options.description,
                    tags: options.tags,
                    coverUrl: options.coverUrl
                }
            })
        });
    };
    return {
        start,
        runBookDownload: async (options) => {
            const call = hoistedBrowserDownloadMocks.runDownload.mock.calls.length;
            await start(options);
            const result = hoistedBrowserDownloadMocks.runDownload.mock.results[call];
            if (!result) throw new Error("Download core was not entered");
            // 返回本次应用流程调用下载核心所得的结果
            return await result.value;
        },
        task,
        abortActiveDownload,
        state,
        get dependencies() {
            return hoistedBrowserDownloadMocks.runDownload.mock.calls.at(-1)![1];
        }
    };
}

export function createBrowserDownloadTasks(count: number) {
    return Array.from({ length: count }, (_, index) => createDownloadTask(index));
}

export function createBrowserDownloadOptions(tasks: ReturnType<typeof createDownloadTask>[]) {
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
        imageEnabled: false,
        tasks
    };
}

export function expectReadyDownload(result: DownloadResult) {
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected export data from download");
    return result.data;
}
