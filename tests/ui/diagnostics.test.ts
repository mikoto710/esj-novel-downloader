// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearBrowserDiagnosticSessions,
    finishBrowserDiagnosticSession,
    listBrowserDiagnosticSessions,
    recordBrowserDiagnosticFailure,
    startBrowserDiagnosticSession
} from "../../src/diagnostics/runtime";
import * as diagnosticRuntime from "../../src/diagnostics/runtime";
import { createDiagnosticPopup } from "../../src/ui/dialogs/diagnostics";
import { createSettingsPanel } from "../../src/ui/popups";
import { setInterfaceLocalePreference } from "../../src/storage/settings";
import * as locale from "../../src/ui/locale";
import * as logger from "../../src/ui/log-view";
import { createDeferred } from "../support/async";
import { deleteTestDatabase } from "../support/resources";

function seedDiagnostic(result: "success" | "failed" = "failed", label: string = result): void {
    const taskId = `task-${label}`;
    startBrowserDiagnosticSession({
        taskId,
        bookId: "1737469479",
        bookTitle: `Diagnostic Book ${label}`,
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
    finishBrowserDiagnosticSession(taskId, result);
}

function diagnosticRow(label: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll<HTMLButtonElement>("#esj-diagnostic-list button")).find((button) =>
        button.textContent?.includes(`Diagnostic Book ${label}`)
    );
}

describe("diagnostic history UI", () => {
    beforeEach(async () => {
        document.body.replaceChildren();
        await clearBrowserDiagnosticSessions();
        setInterfaceLocalePreference("zh-CN");
        vi.spyOn(logger, "log").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        (document.querySelector("#esj-diagnostics .esj-common-header button") as HTMLButtonElement | null)?.click();
        document.querySelector("#esj-diagnostic-clear-confirm")?.remove();
        vi.clearAllTimers();
        vi.useRealTimers();
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        await listBrowserDiagnosticSessions();
        await deleteTestDatabase("esj-novel-downloader-diagnostics");
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
        await vi.waitFor(() =>
            expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book")
        );
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
        await vi.waitFor(() =>
            expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book")
        );

        button.click();
        expect(document.querySelector("#esj-diagnostic-clear-confirm")).not.toBeNull();
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book");

        (document.querySelector("#esj-diagnostic-clear-cancel") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book");

        button.click();
        (document.querySelector("#esj-diagnostic-clear-confirm-button") as HTMLButtonElement).click();
        await vi.waitFor(() =>
            expect(document.querySelector("#esj-diagnostic-list")?.textContent).not.toContain("Diagnostic Book")
        );
        expect((await listBrowserDiagnosticSessions()).history).toEqual([]);
    });

    it("deletes one selected diagnostic without clearing the remaining history", async () => {
        seedDiagnostic("success");
        seedDiagnostic("failed");
        createDiagnosticPopup();

        await vi.waitFor(() => expect(diagnosticRow("failed")).toBeDefined());
        diagnosticRow("failed")?.click();
        (document.querySelector("#esj-diagnostic-delete") as HTMLButtonElement).click();

        await vi.waitFor(() =>
            expect(document.querySelector("#esj-diagnostic-list")?.textContent).not.toContain("Diagnostic Book failed")
        );
        expect((await listBrowserDiagnosticSessions()).history.map((session) => session.taskId)).toEqual([
            "task-success"
        ]);
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book success");
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).not.toContain("Diagnostic Book failed");
    });

    it("preserves a different row selected while deletion is pending", async () => {
        seedDiagnostic("success", "first");
        seedDiagnostic("failed", "deleting");
        seedDiagnostic("success", "other");
        const removing = createDeferred<void>();
        const remove = diagnosticRuntime.removeBrowserDiagnosticSession;
        vi.spyOn(diagnosticRuntime, "removeBrowserDiagnosticSession").mockImplementationOnce(async (id) => {
            await removing.promise;
            await remove(id);
        });
        createDiagnosticPopup();
        await vi.waitFor(() => expect(diagnosticRow("deleting")).toBeDefined());
        const firstRemaining = Array.from(
            document.querySelectorAll<HTMLButtonElement>("#esj-diagnostic-list button")
        ).find((row) => row !== diagnosticRow("deleting"));
        const kept = firstRemaining === diagnosticRow("other") ? "first" : "other";
        diagnosticRow("deleting")?.click();
        document.querySelector<HTMLButtonElement>("#esj-diagnostic-delete")?.click();
        diagnosticRow(kept)?.click();
        removing.resolve();

        await vi.waitFor(() => expect(diagnosticRow("deleting")).toBeUndefined());
        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain(`Diagnostic Book ${kept}`);
    });
});
