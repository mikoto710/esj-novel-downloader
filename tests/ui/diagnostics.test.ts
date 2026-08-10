// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    browserDiagnosticEvents,
    clearBrowserDiagnosticSessions,
    finishBrowserDiagnosticSession,
    recordBrowserDiagnosticFailure,
    startBrowserDiagnosticSession
} from "../../src/adapters/browser-diagnostics";
import { DIAGNOSTIC_CLOSE_UNCONFIRMED_MS } from "../../src/core/diagnostics";
import { createInitialDownloadSnapshot } from "../../src/core/download/state-machine";
import { createDiagnosticPopup } from "../../src/ui/dialogs/diagnostics";
import { showMessagePopup } from "../../src/ui/dialogs/message";
import { createSettingsPanel } from "../../src/ui/popups";
import { setInterfaceLocalePreference } from "../../src/core/config";

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

function dispatchPageHide(persisted: boolean): void {
    const event = new Event("pagehide");
    Object.defineProperty(event, "persisted", { value: persisted });
    window.dispatchEvent(event);
}

describe("diagnostic history UI", () => {
    beforeEach(() => {
        document.body.replaceChildren();
        clearBrowserDiagnosticSessions();
        setInterfaceLocalePreference("zh-CN");
    });

    afterEach(() => {
        (document.querySelector("#esj-diagnostics .esj-common-header button") as HTMLButtonElement | null)?.click();
        document.querySelector("#esj-diagnostic-clear-confirm")?.remove();
        vi.clearAllTimers();
        vi.useRealTimers();
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    });

    it("shows retained sessions, privacy boundaries and selected summary", () => {
        seedDiagnostic();
        createDiagnosticPopup();

        const popup = document.querySelector("#esj-diagnostics") as HTMLElement;
        expect(popup).not.toBeNull();
        expect(popup.textContent).toContain("最近任务（最多 30 条）");
        expect(popup.textContent).toContain("总计 4.0 MiB");
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

    it("shows a localized fallback for a diagnostic without a book title", () => {
        startBrowserDiagnosticSession({
            taskId: "task-untitled",
            bookId: "unknown",
            bookTitle: "",
            pageUrl: "https://www.esjzone.cc/forum/1.html",
            sourcePageType: "single",
            imageEnabled: false
        });
        createDiagnosticPopup();

        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("未知作品");
        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain("未知作品");
    });

    it("labels a running session with protected chapters as waiting for a password", () => {
        startBrowserDiagnosticSession({
            taskId: "task-protected-waiting",
            bookId: "book-protected-waiting",
            bookTitle: "Protected Waiting Book",
            pageUrl: "https://www.esjzone.cc/detail/15.html",
            sourcePageType: "detail",
            imageEnabled: false
        });
        browserDiagnosticEvents.emit({
            type: "snapshot-updated",
            snapshot: {
                ...createInitialDownloadSnapshot(8, 0),
                phase: "downloading",
                protectedDetectedCount: 2,
                protectedPendingCount: 1,
                protectedResolvedCount: 1
            }
        });

        createDiagnosticPopup();

        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("等待输入密码");
        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain("等待输入密码");
        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain(
            "密码章节：发现 2；待处理 1；已解锁 1；已跳过 0"
        );
    });

    it("automatically refreshes only while visible and resumes immediately", async () => {
        vi.useFakeTimers();
        createDiagnosticPopup();
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));

        seedDiagnostic("success");
        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).not.toContain("Diagnostic Book");

        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("Diagnostic Book");
    });

    it("moves a closed session out of active display when a same-book continuation starts", async () => {
        vi.useFakeTimers();
        startBrowserDiagnosticSession(
            {
                taskId: "task-closed",
                bookId: "1737469479",
                bookTitle: "Closed Diagnostic Book",
                pageUrl: "https://www.esjzone.cc/detail/1737469479.html",
                sourcePageType: "detail",
                imageEnabled: false
            },
            { observePageClose: true }
        );
        createDiagnosticPopup();
        dispatchPageHide(false);
        await vi.advanceTimersByTimeAsync(3000);

        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("页面已关闭，结果未确认");

        startBrowserDiagnosticSession({
            taskId: "task-resumed",
            bookId: "1737469479",
            bookTitle: "Resumed Diagnostic Book",
            pageUrl: "https://www.esjzone.cc/forum/1737469479/1.html",
            sourcePageType: "forum",
            imageEnabled: false
        });
        browserDiagnosticEvents.emit({
            type: "phase-changed",
            previous: "idle",
            current: "preparing",
            snapshot: { ...createInitialDownloadSnapshot(2, 0), phase: "preparing" }
        });
        await vi.advanceTimersByTimeAsync(3000);

        const listText = document.querySelector("#esj-diagnostic-list")?.textContent || "";
        expect(listText).toContain("进行中");
        expect(listText).toContain("已由新的续传任务接替");
        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain("旧会话不再视为进行中");
    });

    it("labels a long-closed session as view-only interrupted without changing its raw result", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
        startBrowserDiagnosticSession(
            {
                taskId: "task-interrupted-view",
                bookId: "1737469479",
                bookTitle: "Interrupted View Book",
                pageUrl: "https://www.esjzone.cc/detail/1737469479.html",
                sourcePageType: "detail",
                imageEnabled: false
            },
            { observePageClose: true }
        );
        dispatchPageHide(false);
        vi.advanceTimersByTime(DIAGNOSTIC_CLOSE_UNCONFIRMED_MS);

        createDiagnosticPopup();

        expect(document.querySelector("#esj-diagnostic-list")?.textContent).toContain("异常中断（结果未确认）");
        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain("原始结果：running");
    });

    it("preserves selection and scroll positions during automatic refresh", async () => {
        vi.useFakeTimers();
        seedDiagnostic("success");
        seedDiagnostic("failed");
        createDiagnosticPopup();

        const rows = document.querySelectorAll("#esj-diagnostic-list button");
        (rows[1] as HTMLButtonElement).click();
        const list = document.querySelector("#esj-diagnostic-list") as HTMLElement;
        const detail = document.querySelector("#esj-diagnostic-detail") as HTMLElement;
        list.scrollTop = 34;
        detail.scrollTop = 56;
        const selectedTitle = detail.querySelector("div")?.textContent;

        await vi.advanceTimersByTimeAsync(3000);

        expect(detail.querySelector("div")?.textContent).toBe(selectedTitle);
        expect(list.scrollTop).toBe(34);
        expect(detail.scrollTop).toBe(56);
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

    it("keeps a successful presentation when only inline images failed", () => {
        startBrowserDiagnosticSession({
            taskId: "task-image-only",
            bookId: "1737469479",
            bookTitle: "Image-only diagnostic",
            pageUrl: "https://www.esjzone.cc/detail/1737469479.html",
            sourcePageType: "detail",
            imageEnabled: true
        });
        recordBrowserDiagnosticFailure({
            scope: "image",
            stage: "request",
            code: "image-request-failed",
            message: "图片请求在重试后仍失败",
            imageFailureCount: 2,
            chapter: {
                index: 0,
                title: "Chapter 1",
                url: "https://www.esjzone.cc/forum/1737469479/1.html"
            }
        });
        finishBrowserDiagnosticSession("task-image-only", "success");

        createDiagnosticPopup();

        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain("下载完成");
        expect(document.querySelector("#esj-diagnostic-detail")?.textContent).toContain("失败插图：2 张");
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

    it("cleans automatic refresh and its settings lock after external removal", async () => {
        vi.useFakeTimers();
        const settingsTrigger = document.createElement("button");
        settingsTrigger.className = "esj-settings-trigger";
        document.body.appendChild(settingsTrigger);
        createSettingsPanel();
        (
            Array.from(document.querySelectorAll("#esj-settings button")).find(
                (item) => item.textContent === "诊断日志"
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
                (item) => item.textContent === "诊断日志"
            ) as HTMLButtonElement
        ).click();

        createDiagnosticPopup();

        expect(document.querySelectorAll("#esj-diagnostics")).toHaveLength(1);
        expect(settingsTrigger.disabled).toBe(true);
        (document.querySelector("#esj-diagnostics .esj-common-header button") as HTMLButtonElement).click();
        expect(settingsTrigger.disabled).toBe(false);
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
