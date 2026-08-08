// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { createDownloadHistoryPopup } from "../../src/ui/download-history";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";

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

    it("refreshes the open table in place and preserves active filters", async () => {
        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelectorAll("#esj-download-history tbody tr")).toHaveLength(2));
        const popup = document.querySelector("#esj-download-history") as HTMLElement;
        const selects = Array.from(popup.querySelectorAll("select")) as HTMLSelectElement[];
        selects[0].value = "book";
        selects[1].value = "epub";
        selects[2].value = "detail";
        selects[0].dispatchEvent(new Event("change"));

        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();

        expect(document.querySelector("#esj-download-history")).toBe(popup);
        expect(selects.map((select) => select.value)).toEqual(["book", "epub", "detail"]);
        expect(popup.textContent).toContain("下载记录");
        expect(popup.textContent).toContain("共 12 章（其中 2 章为缺失占位）");
    });
});
