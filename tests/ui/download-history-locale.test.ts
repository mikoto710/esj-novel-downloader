// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { createDownloadHistoryPopup } from "../../src/ui/dialogs/download-history";
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
                id: "range",
                bookName: "Range Book",
                author: "Author",
                format: "html",
                sourcePageType: "forum",
                chapterSummary: { totalCount: 20, missingCount: 1 },
                selection: {
                    mode: "range",
                    sourceTotalChapters: 120,
                    startChapter: 101,
                    endChapter: 120
                },
                pageUrl: "https://www.esjzone.cc/forum/120.html",
                exportedAt: Date.now() + 1
            },
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
            expect(text).toContain("第 101–120 章，共 20 章（其中 1 章為缺章說明）");
            expect(text).toContain("範圍");
            expect(text).toContain("舊版章節文字");
        });
    });

    it("uses a compact delete label with a descriptive title", async () => {
        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelectorAll("#esj-download-history tbody tr")).toHaveLength(3));

        const deleteButton = document.querySelector(
            "#esj-download-history tbody tr:first-child td:last-child button:last-child"
        ) as HTMLButtonElement;

        expect(deleteButton.textContent).toBe("刪除");
        expect(deleteButton.title).toBe("刪除紀錄");
    });

    it("resizes adjacent columns and preserves their widths across locale refresh", async () => {
        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelectorAll("#esj-download-history tbody tr")).toHaveLength(3));

        const table = document.querySelector("#esj-download-history table") as HTMLTableElement;
        const columns = Array.from(table.querySelectorAll<HTMLTableColElement>("col"));
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
        const handles = Array.from(table.querySelectorAll<HTMLElement>(".esj-history-column-resizer"));
        const columnWidths = [210, 120, 90, 80, 80, 140, 90, 120, 70];
        vi.spyOn(table, "getBoundingClientRect").mockReturnValue({ width: 1000 } as DOMRect);
        headers.forEach((header, index) => {
            vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ width: columnWidths[index] } as DOMRect);
        });

        expect(handles).toHaveLength(8);
        handles[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 210 }));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 240 }));
        document.dispatchEvent(new MouseEvent("mouseup"));

        expect(columns[0].style.width).toBe("24%");
        expect(columns[1].style.width).toBe("9%");

        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();

        expect(headers[0].querySelector(".esj-history-column-resizer")).toBe(handles[0]);
        expect(columns[0].style.width).toBe("24%");
        expect(columns[1].style.width).toBe("9%");
        expect(headers[0].textContent).toContain("书名");
    });

    it("refreshes the open table in place and preserves active filters", async () => {
        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelectorAll("#esj-download-history tbody tr")).toHaveLength(3));
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
