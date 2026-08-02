// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
    clearBrowserDiagnosticSessions,
    finishBrowserDiagnosticSession,
    recordBrowserDiagnosticFailure,
    startBrowserDiagnosticSession
} from "../../src/adapters/browser-diagnostics";
import { createDiagnosticPopup } from "../../src/ui/diagnostics";
import { showMessagePopup } from "../../src/ui/message-popup";
import { createSettingsPanel } from "../../src/ui/popups";

function seedDiagnostic(result: "success" | "failed" = "failed"): void {
    startBrowserDiagnosticSession({
        taskId: `task-${result}`,
        bookId: "1737469479",
        bookTitle: "Diagnostic Book",
        pageUrl: "https://www.esjzone.cc/detail/1737469479.html",
        sourcePageType: "detail",
        imageEnabled: false
    });
    if (result === "failed") {
        recordBrowserDiagnosticFailure({
            scope: "chapter",
            stage: "fetch",
            code: "network-error",
            message: "request failed",
            chapter: {
                index: 0,
                title: "Chapter 1",
                url: "https://www.esjzone.cc/forum/1737469479/1.html"
            }
        });
    }
    finishBrowserDiagnosticSession(`task-${result}`, result);
}

describe("diagnostic history UI", () => {
    beforeEach(() => {
        document.body.replaceChildren();
        clearBrowserDiagnosticSessions();
    });

    it("shows retained sessions, privacy boundaries and selected summary", () => {
        seedDiagnostic();
        createDiagnosticPopup();

        const popup = document.querySelector("#esj-diagnostics") as HTMLElement;
        expect(popup).not.toBeNull();
        expect(popup.textContent).toContain("最近任务（最多 10 条）");
        expect(popup.textContent).toContain("Diagnostic Book");
        expect(popup.textContent).toContain("作品链接和失败章节信息");
        expect(popup.textContent).toContain("network-error");
        expect((popup.querySelector("#esj-diagnostic-download") as HTMLButtonElement).disabled).toBe(false);
        expect((popup.querySelector("#esj-diagnostic-copy") as HTMLButtonElement).disabled).toBe(false);
    });

    it("refreshes diagnostic history from persistent storage", () => {
        createDiagnosticPopup();
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("暂无记录");

        seedDiagnostic("success");
        (document.querySelector("#esj-diagnostic-refresh") as HTMLButtonElement).click();

        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book");
    });

    it("opens diagnostics from settings", () => {
        seedDiagnostic("success");
        const settingsTrigger = document.createElement("button");
        settingsTrigger.className = "esj-settings-trigger";
        document.body.appendChild(settingsTrigger);
        createSettingsPanel();

        const button = Array.from(document.querySelectorAll("#esj-settings button")).find(
            (item) => item.textContent === "诊断日志"
        ) as HTMLButtonElement;
        button.click();

        expect(document.querySelector("#esj-settings")).toBeNull();
        expect(document.querySelector("#esj-diagnostics")).not.toBeNull();
        expect(settingsTrigger.disabled).toBe(true);

        (document.querySelector("#esj-diagnostics .esj-common-header button") as HTMLButtonElement).click();
        expect(settingsTrigger.disabled).toBe(false);
    });

    it("does not release a settings lock owned by another popup", () => {
        const settingsTrigger = document.createElement("button");
        settingsTrigger.className = "esj-settings-trigger";
        settingsTrigger.disabled = true;
        document.body.appendChild(settingsTrigger);

        createDiagnosticPopup();
        (document.querySelector("#esj-diagnostics .esj-common-header button") as HTMLButtonElement).click();

        expect(settingsTrigger.disabled).toBe(true);
    });

    it("offers diagnostic access from an error popup when a session exists", () => {
        seedDiagnostic();
        showMessagePopup({ tone: "error", title: "Download failed", message: "Try again" });

        const button = document.querySelector("#esj-message-diagnostic") as HTMLButtonElement;
        expect(button.textContent).toBe("查看诊断日志");
        button.click();

        expect(document.querySelector("#esj-message-popup")).toBeNull();
        expect(document.querySelector("#esj-diagnostics")).not.toBeNull();
    });

    it("does not show a diagnostic shortcut when no session exists", () => {
        showMessagePopup({ tone: "error", message: "No diagnostic context" });
        expect(document.querySelector("#esj-message-diagnostic")).toBeNull();
    });

    it("confirms with a popup before clearing all records", async () => {
        seedDiagnostic();
        createDiagnosticPopup();
        const button = document.querySelector("#esj-diagnostic-clear") as HTMLButtonElement;

        button.click();
        expect(document.querySelector("#esj-diagnostic-clear-confirm")).not.toBeNull();
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book");

        (document.querySelector("#esj-diagnostic-clear-cancel") as HTMLButtonElement).click();
        await Promise.resolve();
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book");

        button.click();
        (document.querySelector("#esj-diagnostic-clear-confirm-button") as HTMLButtonElement).click();
        await Promise.resolve();
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("暂无记录");
    });

    it("deletes one selected diagnostic without clearing the remaining history", () => {
        seedDiagnostic("success");
        seedDiagnostic("failed");
        createDiagnosticPopup();

        (document.querySelector("#esj-diagnostic-delete") as HTMLButtonElement).click();

        expect(document.querySelector("#esj-diagnostic-list")?.textContent).not.toContain("任务失败");
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("下载完成");
    });
});
