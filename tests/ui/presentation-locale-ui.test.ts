// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { createCacheManagerPopup } from "../../src/ui/cache-manager";
import { createDiagnosticPopup } from "../../src/ui/diagnostics";
import { createDownloadHistoryPopup } from "../../src/ui/download-history";

describe("cache, history, and diagnostic locale presentation", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
        setInterfaceLocalePreference("zh-TW");
    });

    it("renders empty management views in traditional Chinese", async () => {
        createCacheManagerPopup();
        await vi.waitFor(() => {
            expect(document.querySelector("#esj-cache-manager")?.textContent).toContain("快取管理");
            expect(document.querySelector("#esj-cache-manager")?.textContent).toContain("目前沒有可管理的快取");
        });

        document.querySelector("#esj-cache-manager .esj-common-header button")?.dispatchEvent(new MouseEvent("click"));
        createDownloadHistoryPopup();
        await vi.waitFor(() => {
            expect(document.querySelector("#esj-download-history")?.textContent).toContain("下載記錄");
            expect(document.querySelector("#esj-download-history")?.textContent).toContain("暫無下載記錄");
        });

        document.querySelector("#esj-download-history .esj-common-header button")?.dispatchEvent(new MouseEvent("click"));
        createDiagnosticPopup();
        expect(document.querySelector("#esj-diagnostics")?.textContent).toContain("診斷日誌");
        expect(document.querySelector("#esj-diagnostics")?.textContent).toContain("暫無記錄");
    });
});
