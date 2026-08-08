// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { createCacheManagerPopup } from "../../src/ui/cache-manager";
import { createDiagnosticPopup } from "../../src/ui/diagnostics";
import { createDownloadHistoryPopup } from "../../src/ui/download-history";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";

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
            expect(document.querySelector("#esj-download-history")?.textContent).toContain("下載紀錄");
            expect(document.querySelector("#esj-download-history")?.textContent).toContain("暫無下載紀錄");
        });

        document
            .querySelector("#esj-download-history .esj-common-header button")
            ?.dispatchEvent(new MouseEvent("click"));
        createDiagnosticPopup();
        expect(document.querySelector("#esj-diagnostics")?.textContent).toContain("診斷紀錄");
        expect(document.querySelector("#esj-diagnostics")?.textContent).toContain("暫無紀錄");
    });

    it("refreshes open cache and diagnostic views without replacing their popup roots", async () => {
        createCacheManagerPopup();
        const cachePopup = document.querySelector("#esj-cache-manager") as HTMLElement;
        await vi.waitFor(() => expect(cachePopup.textContent).toContain("快取管理"));

        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();
        await vi.waitFor(() => expect(cachePopup.textContent).toContain("缓存管理"));
        expect(document.querySelector("#esj-cache-manager")).toBe(cachePopup);

        cachePopup.querySelector(".esj-common-header button")?.dispatchEvent(new MouseEvent("click"));
        setInterfaceLocalePreference("zh-TW");
        createDiagnosticPopup();
        const diagnosticPopup = document.querySelector("#esj-diagnostics") as HTMLElement;

        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();

        expect(document.querySelector("#esj-diagnostics")).toBe(diagnosticPopup);
        expect(diagnosticPopup.textContent).toContain("诊断日志");
    });
});
