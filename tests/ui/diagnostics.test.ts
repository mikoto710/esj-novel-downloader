// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearBrowserDiagnosticSessions,
    finishBrowserDiagnosticSession,
    listBrowserDiagnosticSessions,
    recordBrowserDiagnosticFailure,
    startBrowserDiagnosticSession
} from "../../src/adapters/browser-diagnostics";
import { createDiagnosticPopup } from "../../src/ui/dialogs/diagnostics";
import { createSettingsPanel } from "../../src/ui/popups";
import { setInterfaceLocalePreference } from "../../src/storage/settings";
import * as locale from "../../src/ui/locale";
import * as logger from "../../src/utils/log";

function seedDiagnostic(result: "success" | "failed" = "failed"): void {
    startBrowserDiagnosticSession({
        taskId: `task-${result}`,
        bookId: "1737469479",
        bookTitle: `Diagnostic Book ${result}`,
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
        setInterfaceLocalePreference("zh-CN");
        vi.spyOn(logger, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        (document.querySelector("#esj-diagnostics .esj-common-header button") as HTMLButtonElement | null)?.click();
        document.querySelector("#esj-diagnostic-clear-confirm")?.remove();
        vi.clearAllTimers();
        vi.useRealTimers();
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    });

    it("does not refresh while a clear confirmation is open", async () => {
        vi.useFakeTimers();
        createDiagnosticPopup();
        (document.querySelector("#esj-diagnostic-clear") as HTMLButtonElement).click();
        seedDiagnostic("success");

        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).not.toContain("Diagnostic Book");

        (document.querySelector("#esj-diagnostic-clear-cancel") as HTMLButtonElement).click();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book");
    });

    it("cleans automatic refresh and its settings lock after external removal", async () => {
        vi.useFakeTimers();
        const settingsTrigger = document.createElement("button");
        settingsTrigger.className = "esj-settings-trigger";
        document.body.appendChild(settingsTrigger);
        createSettingsPanel();
        (
            Array.from(document.querySelectorAll("#esj-settings button")).find(
                (item) => item.textContent === locale.t("settings.diagnosticsButton")
            ) as HTMLButtonElement
        ).click();

        (document.querySelector("#esj-diagnostics") as HTMLElement).remove();
        await Promise.resolve();

        expect(settingsTrigger.disabled).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps the settings lock when replacing an open diagnostic popup", () => {
        const settingsTrigger = document.createElement("button");
        settingsTrigger.className = "esj-settings-trigger";
        document.body.appendChild(settingsTrigger);
        createSettingsPanel();
        (
            Array.from(document.querySelectorAll("#esj-settings button")).find(
                (item) => item.textContent === locale.t("settings.diagnosticsButton")
            ) as HTMLButtonElement
        ).click();

        createDiagnosticPopup();

        expect(document.querySelectorAll("#esj-diagnostics")).toHaveLength(1);
        expect(settingsTrigger.disabled).toBe(true);
        (document.querySelector("#esj-diagnostics .esj-common-header button") as HTMLButtonElement).click();
        expect(settingsTrigger.disabled).toBe(false);
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
        expect((document.querySelector("#esj-diagnostic-download") as HTMLButtonElement).disabled).toBe(true);
    });

    it("deletes one selected diagnostic without clearing the remaining history", () => {
        seedDiagnostic("success");
        seedDiagnostic("failed");
        createDiagnosticPopup();

        (document.querySelector("#esj-diagnostic-delete") as HTMLButtonElement).click();

        expect(listBrowserDiagnosticSessions().history.map((session) => session.taskId)).toEqual(["task-success"]);
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book success");
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).not.toContain("Diagnostic Book failed");
    });
});
