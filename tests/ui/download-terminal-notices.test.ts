// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../../src/ui/messages/download-terminal";
import { setInterfaceLocalePreference } from "../../src/core/config";

vi.mock("../../src/adapters/browser-diagnostics", () => ({
    listBrowserDiagnosticSessions: () => ({ schemaVersion: 1, active: [], history: [] })
}));

describe("download terminal notices", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        setInterfaceLocalePreference("zh-CN");
    });

    it("uses the common popup for an unexpected download failure", () => {
        showDownloadTerminalFailure({
            kind: "download",
            code: "Error",
            params: { errorName: "Error", detail: "parser failed" },
            storageFailure: null
        });

        const popup = document.querySelector("#esj-message-popup") as HTMLElement;
        expect(popup.dataset.tone).toBe("error");
        expect(popup.textContent).toContain("下载任务失败");
        expect(popup.textContent).toContain("parser failed");
        expect(document.querySelector("#esj-message-close")).not.toBeNull();
    });

    it("explains that the latest progress may be missing after a cancellation timeout", () => {
        showDownloadTerminalFailure({
            kind: "cancellation",
            outcome: "save-timed-out",
            storageFailure: { reason: "flush-timeout", operation: "flush", message: "缓存写入超时" }
        });

        expect(document.querySelector("#esj-message-popup")?.textContent).toContain("进度保存超时");
        expect(document.querySelector("#esj-message-popup")?.textContent).toContain("最后一次成功写入的缓存");
    });

    it("keeps cache discard failure distinct from cancellation itself", () => {
        showCacheDiscardFailure({
            reason: "transaction-aborted",
            operation: "clear",
            message: "IndexedDB 事务意外中止"
        });

        expect(document.querySelector("#esj-message-popup")?.textContent).toContain("缓存清理失败");
        expect(document.querySelector("#esj-message-popup")?.textContent).toContain("任务已经停止");
    });

    it("renders terminal storage failures in the current traditional Chinese locale", () => {
        setInterfaceLocalePreference("zh-TW");

        showDownloadTerminalFailure({
            kind: "cancellation",
            outcome: "save-timed-out",
            storageFailure: { reason: "flush-timeout", operation: "flush", message: "缓存写入超时" }
        });

        expect(document.querySelector("#esj-message-popup")?.textContent).toContain("進度儲存逾時");
        expect(document.querySelector("#esj-message-popup")?.textContent).toContain("快取寫入逾時");
    });
});
