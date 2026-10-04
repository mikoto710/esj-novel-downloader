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

    it("keeps structured range counts and legacy chapter text readable", async () => {
        createDownloadHistoryPopup();

        await vi.waitFor(() => {
            const text = document.querySelector("#esj-download-history")?.textContent;
            expect(text).toContain("12");
            expect(text).toContain("101–120");
            expect(text).toContain("20");
            expect(text).toContain("舊版章節文字");
        });
    });

    it("resizes adjacent columns and preserves their widths across locale refresh", async () => {
        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelectorAll("#esj-download-history tbody tr")).toHaveLength(3));

        const table = document.querySelector("#esj-download-history table") as HTMLTableElement;
        const columns = Array.from(table.querySelectorAll<HTMLTableColElement>("col"));
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
        const handles = Array.from(table.querySelectorAll<HTMLElement>(".esj-history-column-resizer"));
        const columnWidths = headers.map(() => 120);
        vi.spyOn(table, "getBoundingClientRect").mockReturnValue({ width: 1000 } as DOMRect);
        headers.forEach((header, index) => {
            vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ width: columnWidths[index] } as DOMRect);
        });

        handles[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 210 }));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 240 }));
        document.dispatchEvent(new MouseEvent("mouseup"));

        const resizedWidths = columns.map((column) => column.style.width);
        expect(parseFloat(resizedWidths[0])).toBeGreaterThan((columnWidths[0] / 1000) * 100);
        expect(parseFloat(resizedWidths[1])).toBeLessThan((columnWidths[1] / 1000) * 100);
        expect(parseFloat(resizedWidths[0]) + parseFloat(resizedWidths[1])).toBeCloseTo(
            ((columnWidths[0] + columnWidths[1]) / 1000) * 100
        );

        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();

        expect(headers[0].querySelector(".esj-history-column-resizer")).toBe(handles[0]);
        expect(columns.map((column) => column.style.width)).toEqual(resizedWidths);
    });

    it("refreshes the open table in place and preserves active filters", async () => {
        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelectorAll("#esj-download-history tbody tr")).toHaveLength(3));
        const popup = document.querySelector("#esj-download-history") as HTMLElement;
        const previousText = popup.textContent;
        const selects = Array.from(popup.querySelectorAll("select")) as HTMLSelectElement[];
        selects[0].value = "book";
        selects[1].value = "epub";
        selects[2].value = "detail";
        selects[0].dispatchEvent(new Event("change"));

        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();

        expect(document.querySelector("#esj-download-history")).toBe(popup);
        expect(selects.map((select) => select.value)).toEqual(["book", "epub", "detail"]);
        expect(popup.textContent).not.toBe(previousText);
        expect(popup.textContent).toContain("Structured Book");
        expect(popup.textContent).not.toContain("Range Book");
        expect(popup.textContent).not.toContain("Legacy Book");
    });
});
