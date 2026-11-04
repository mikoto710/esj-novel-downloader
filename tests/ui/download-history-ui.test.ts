// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import * as history from "../../src/storage/history";
import { createDownloadHistoryPopup } from "../../src/ui/dialogs/download-history";
import { fullCleanup } from "../../src/ui/dom";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";
import { setInterfaceLocalePreference } from "../../src/storage/settings";
import { createDeferred } from "../support";

describe("download history interactions", () => {
    afterEach(() => {
        fullCleanup();
        vi.restoreAllMocks();
    });

    it("keeps the row available for retry when deleting it fails", async () => {
        const record: history.DownloadHistoryItem = {
            id: "kept",
            bookName: "Saved book",
            author: "Test author",
            format: "txt",
            sourcePageType: "detail",
            pageUrl: "https://example.com/book",
            exportedAt: 1
        };
        vi.spyOn(history, "listDownloadHistory").mockResolvedValue([record]);
        vi.spyOn(history, "removeDownloadHistory").mockRejectedValue(new Error("transaction interrupted"));
        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelector("tbody")?.textContent).toContain(record.bookName));

        document.querySelectorAll<HTMLButtonElement>("tbody button")[1].click();

        await vi.waitFor(() =>
            expect(document.querySelector("#esj-message-details")?.textContent).toContain("transaction interrupted")
        );
        expect(document.querySelector("tbody")?.textContent).toContain(record.bookName);
    });

    it("deletes the selected row after filtering and retains the filter through async refresh", async () => {
        let records: history.DownloadHistoryItem[] = [0, 1].map((index) => ({
            id: `export-${index}`,
            bookName: "Same book",
            author: "Test author",
            format: index === 0 ? "txt" : "html",
            sourcePageType: "detail",
            pageUrl: "https://example.com/book",
            exportedAt: index + 1
        }));
        const deletion = createDeferred<void>();
        vi.spyOn(history, "listDownloadHistory").mockImplementation(async () => [...records]);
        vi.spyOn(history, "removeDownloadHistory").mockImplementation(async (id) => {
            await deletion.promise;
            records = records.filter((record) => record.id !== id);
        });

        createDownloadHistoryPopup();
        await vi.waitFor(() => expect(document.querySelectorAll("tbody tr")).toHaveLength(2));
        const formatFilter = document.querySelectorAll<HTMLSelectElement>("#esj-download-history select")[1];
        formatFilter.value = "html";
        formatFilter.dispatchEvent(new Event("change"));
        const deleteButton = document.querySelectorAll<HTMLButtonElement>("tbody button")[1];
        deleteButton.click();
        expect(document.querySelector("#esj-download-history-confirm")).toBeNull();

        // 删除完成前切换语言，不能改变此次操作捕获的记录或当前筛选
        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();
        deletion.resolve();
        await vi.waitFor(() => expect(records.map((record) => record.id)).toEqual(["export-0"]));
        await vi.waitFor(() => expect(document.querySelectorAll("tbody button")).toHaveLength(0));
        expect(formatFilter.value).toBe("html");

        formatFilter.value = "all";
        formatFilter.dispatchEvent(new Event("change"));
        expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
        expect(document.querySelector("tbody")?.textContent).toContain("TXT");
    });
});
