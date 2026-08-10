import { vi } from "vitest";
import type { ProtectedChapterDecision } from "../../src/core/download/contracts";
import { createBookLock, createDownloadTask } from "./factories";

const hoistedBrowserDownloadMocks = vi.hoisted(() => ({
    log: vi.fn(),
    sleepWithAbort: vi.fn(),
    sleep: vi.fn(),
    fetchWithTimeout: vi.fn(),
    fullCleanup: vi.fn(),
    createDownloadPopup: vi.fn(),
    showFormatChoice: vi.fn(),
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
    shouldDiscard: vi.fn()
}));

export function getBrowserDownloadMocks() {
    return hoistedBrowserDownloadMocks;
}

vi.mock("../../src/core/cache/sync", () => ({
    subscribeCacheSync: vi.fn(() => vi.fn()),
    publishCacheSyncEvent: vi.fn()
}));
vi.mock("../../src/utils/log", () => ({ log: hoistedBrowserDownloadMocks.log }));
vi.mock("../../src/utils/async", () => ({
    sleepWithAbort: hoistedBrowserDownloadMocks.sleepWithAbort,
    sleep: hoistedBrowserDownloadMocks.sleep
}));
vi.mock("../../src/utils/request", () => ({ fetchWithTimeout: hoistedBrowserDownloadMocks.fetchWithTimeout }));
vi.mock("../../src/utils/dom", () => ({ fullCleanup: hoistedBrowserDownloadMocks.fullCleanup }));
vi.mock("../../src/ui/popups", () => ({
    createDownloadPopup: hoistedBrowserDownloadMocks.createDownloadPopup,
    showFormatChoice: hoistedBrowserDownloadMocks.showFormatChoice,
    confirmMappingFontDownload: hoistedBrowserDownloadMocks.confirmMappingFontDownload,
    confirmIncompleteChapters: hoistedBrowserDownloadMocks.confirmIncompleteChapters,
    promptProtectedChapterPassword: hoistedBrowserDownloadMocks.promptProtectedChapterPassword,
    closeProtectedChapterPrompt: hoistedBrowserDownloadMocks.closeProtectedChapterPrompt,
    updateMappingFontWarning: hoistedBrowserDownloadMocks.updateMappingFontWarning,
    showMappingFontFailure: hoistedBrowserDownloadMocks.showMappingFontFailure
}));
vi.mock("../../src/ui/messages/download-terminal", () => ({
    showDownloadTerminalFailure: hoistedBrowserDownloadMocks.showTerminalFailure
}));
vi.mock("../../src/ui/tray", () => ({ updateTrayText: hoistedBrowserDownloadMocks.updateTrayText }));
vi.mock("../../src/core/cache/book-cache", () => ({
    putBookCacheBatchForTask: hoistedBrowserDownloadMocks.saveCache,
    finishBookCacheForTask: hoistedBrowserDownloadMocks.finishCache,
    clearBookCacheForTask: hoistedBrowserDownloadMocks.clearCache,
    loadBookCover: hoistedBrowserDownloadMocks.loadCoverCache,
    putBookCoverForTask: hoistedBrowserDownloadMocks.saveCoverCache
}));
vi.mock("../../src/core/config", () => ({
    getConcurrency: hoistedBrowserDownloadMocks.getConcurrency,
    getInterfaceLocalePreference: hoistedBrowserDownloadMocks.getInterfaceLocalePreference
}));
vi.mock("../../src/utils/image", () => ({ processHtmlImages: hoistedBrowserDownloadMocks.processHtmlImages }));
vi.mock("../../src/core/parser", () => ({ parseChapterHtml: hoistedBrowserDownloadMocks.parseChapterHtml }));
vi.mock("../../src/core/book-lock", () => ({
    ownsActiveBookDownloadLock: hoistedBrowserDownloadMocks.ownsLock,
    shouldDiscardBookDownloadCache: hoistedBrowserDownloadMocks.shouldDiscard
}));

export interface BrowserDownloadRuntime {
    batchDownload: typeof import("../../src/core/download/batch-download").batchDownload;
    abortActiveDownload: typeof import("../../src/core/state").abortActiveDownload;
    state: typeof import("../../src/core/state").state;
}

export async function resetBrowserDownloadHarness(): Promise<BrowserDownloadRuntime> {
    const [{ batchDownload }, stateRuntime] = await Promise.all([
        import("../../src/core/download/batch-download"),
        import("../../src/core/state")
    ]);
    const { abortActiveDownload, resetAbortController, setAbortFlag, state } = stateRuntime;
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
    return { batchDownload, abortActiveDownload, state };
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
