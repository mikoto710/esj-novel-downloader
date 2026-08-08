// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { createDownloadHistoryPopup } from "../../src/ui/download-history";

const mocks = vi.hoisted(() => ({
    listDownloadHistory: vi.fn(),
    removeDownloadHistory: vi.fn(async () => undefined),
    clearDownloadHistory: vi.fn(async () => undefined)
}));

vi.mock("../../src/core/download-history", () => ({
    DOWNLOAD_HISTORY_LIMIT: 100,
    listDownloadHistory: mocks.listDownloadHistory,
    removeDownloadHistory: mocks.removeDownloadHistory,
    clearDownloadHistory: mocks.clearDownloadHistory
}));

describe("download history chapter summary locale", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        setInterfaceLocalePreference("zh-TW");
        mocks.listDownloadHistory.mockResolvedValue([
            {
                id: "structured",
                bookName: "Structured Book",
                author: "Author",
                format: "epub",
                sourcePageType: "detail",
                chapterSummary: { totalCount: 12, missingCount: 2 },
                pageUrl: "https://www.esjzone.cc/detail/12.html",
                exportedAt: Date.now()
            },
            {
                id: "legacy",
                bookName: "Legacy Book",
                author: "Author",
                format: "txt",
                sourcePageType: "single",
                chapterInfo: "舊版章節文字",
                pageUrl: "https://www.esjzone.cc/forum/12/1.html",
                exportedAt: Date.now() - 1
            }
        ]);
    });

    it("formats structured counts in Taiwanese wording and keeps legacy text readable", async () => {
        createDownloadHistoryPopup();

        await vi.waitFor(() => {
            const text = document.querySelector("#esj-download-history")?.textContent;
            expect(text).toContain("共 12 章（其中 2 章為缺章說明）");
            expect(text).toContain("舊版章節文字");
        });
    });
});
