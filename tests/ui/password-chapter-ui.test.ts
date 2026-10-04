// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeProtectedChapterPrompt, promptProtectedChapterPassword } from "../../src/ui/popups";
import { createDownloadTask } from "../support";
import { setInterfaceLocalePreference } from "../../src/core/config";
import { publishInterfaceLocaleChange } from "../../src/ui/locale";

function prompt(signal?: AbortSignal) {
    return promptProtectedChapterPassword(
        {
            task: createDownloadTask(36, { title: "第 37 章 暗号", url: "https://www.esjzone.cc/forum/100/37.html" }),
            totalChapters: 300,
            pendingCount: 3
        },
        signal
    );
}

describe("protected chapter password UI", () => {
    beforeEach(() => {
        closeProtectedChapterPrompt();
        setInterfaceLocalePreference("zh-CN");
    });

    it("shows the exact chapter identity, queue count, link, and memory scope", async () => {
        const decision = prompt();
        const popup = document.querySelector("#esj-protected-chapter") as HTMLElement;

        expect(popup.textContent).toContain("第 37 章 暗号");
        expect(popup.textContent).toContain("37/300");
        expect((popup.querySelector("a") as HTMLAnchorElement).href).toBe("https://www.esjzone.cc/forum/100/37.html");
        expect((popup.querySelector("#esj-protected-remember") as HTMLInputElement).checked).toBe(false);

        (popup.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("separates selected order from the absolute source chapter in range mode", async () => {
        const decision = promptProtectedChapterPassword({
            task: createDownloadTask(100, { title: "第 101 章", url: "https://www.esjzone.cc/forum/100/101.html" }),
            totalChapters: 20,
            taskOrder: 1,
            sourceTotalChapters: 120,
            selectionMode: "range",
            pendingCount: 1
        });
        const popup = document.querySelector("#esj-protected-chapter") as HTMLElement;

        expect(popup.textContent).toContain("1/20");
        expect(popup.textContent).toContain("101");
        (popup.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("refreshes the open prompt in place without clearing the password or remember choice", async () => {
        const decision = prompt();
        const popup = document.querySelector("#esj-protected-chapter") as HTMLElement;
        const input = popup.querySelector("#esj-protected-password") as HTMLInputElement;
        const remember = popup.querySelector("#esj-protected-remember") as HTMLInputElement;
        input.value = "draft-password";
        remember.checked = true;
        const previousText = popup.textContent;

        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();

        expect(document.querySelector("#esj-protected-chapter")).toBe(popup);
        expect(popup.textContent).not.toBe(previousText);
        expect(input.value).toBe("draft-password");
        expect(remember.checked).toBe(true);
        (popup.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("submits a password and explicit task-only reuse choice", async () => {
        const decision = prompt();
        const input = document.querySelector("#esj-protected-password") as HTMLInputElement;
        const remember = document.querySelector("#esj-protected-remember") as HTMLInputElement;
        input.value = "fictional-password";
        remember.checked = true;
        (document.querySelector("#esj-protected-submit") as HTMLButtonElement).click();

        await expect(decision).resolves.toEqual({
            action: "submit",
            password: "fictional-password",
            rememberPassword: true
        });
        expect(document.querySelector("#esj-protected-chapter")).not.toBeNull();
        expect(input.disabled).toBe(true);
        expect(remember.disabled).toBe(true);
        expect((document.querySelector("#esj-protected-submit") as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector("#esj-protected-skip") as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector("#esj-protected-skip-all") as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector("#esj-protected-cancel") as HTMLButtonElement).disabled).toBe(false);
        closeProtectedChapterPrompt();
    });

    it.each([
        ["#esj-protected-skip", { action: "skip-current" }],
        ["#esj-protected-skip-all", { action: "skip-all" }],
        ["#esj-protected-cancel", { action: "cancel" }]
    ])("returns and cleans up the %s decision", async (selector, expected) => {
        const decision = prompt();
        (document.querySelector(selector) as HTMLButtonElement).click();

        await expect(decision).resolves.toEqual(expected);
        expect(document.querySelector("#esj-protected-chapter")).toBeNull();
    });

    it("returns cancellation and removes the prompt when the task aborts", async () => {
        const controller = new AbortController();
        const decision = prompt(controller.signal);

        controller.abort();

        await expect(decision).resolves.toEqual({ action: "cancel" });
        expect(document.querySelector("#esj-protected-chapter")).toBeNull();
    });

    it("keeps an empty password in the same prompt", async () => {
        const decision = prompt();
        (document.querySelector("#esj-protected-submit") as HTMLButtonElement).click();

        expect(document.querySelector("#esj-protected-error")?.textContent).toBeTruthy();
        expect(document.querySelector("#esj-protected-chapter")).not.toBeNull();
        (document.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("keeps the same popup while showing a rejected password and reconnect state", async () => {
        const firstDecision = prompt();
        const popup = document.querySelector("#esj-protected-chapter") as HTMLElement;
        const input = popup.querySelector("#esj-protected-password") as HTMLInputElement;
        input.value = "wrong";
        (popup.querySelector("#esj-protected-submit") as HTMLButtonElement).click();
        await firstDecision;

        const rejection = "ESJ password rejection";
        const rejectedDecision = promptProtectedChapterPassword({
            task: createDownloadTask(36),
            totalChapters: 300,
            pendingCount: 3,
            message: rejection
        });
        expect(document.querySelector("#esj-protected-chapter")).toBe(popup);
        expect((popup.querySelector("#esj-protected-password") as HTMLInputElement).value).toBe("");
        expect(popup.querySelector("#esj-protected-error")?.textContent).toBe(rejection);
        (popup.querySelector("#esj-protected-skip") as HTMLButtonElement).click();
        await expect(rejectedDecision).resolves.toEqual({ action: "skip-current" });

        const reconnectDecision = promptProtectedChapterPassword({
            task: createDownloadTask(36),
            totalChapters: 300,
            pendingCount: 3,
            messageCode: "connection-failed",
            initialPassword: "remembered",
            rememberPassword: true,
            retryConnection: true
        });
        document.querySelector<HTMLButtonElement>("#esj-protected-submit")!.click();
        await expect(reconnectDecision).resolves.toEqual({
            action: "submit",
            password: "remembered",
            rememberPassword: true
        });
        closeProtectedChapterPrompt();
    });

    it("preserves ESJ status 206 text across locale changes", async () => {
        setInterfaceLocalePreference("zh-TW");
        const sourceDecision = promptProtectedChapterPassword({
            task: createDownloadTask(36),
            totalChapters: 300,
            pendingCount: 1,
            message: "ESJ source message"
        });
        expect(document.querySelector("#esj-protected-error")?.textContent).toBe("ESJ source message");
        setInterfaceLocalePreference("zh-CN");
        publishInterfaceLocaleChange();
        expect(document.querySelector("#esj-protected-error")?.textContent).toBe("ESJ source message");
        (document.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(sourceDecision).resolves.toEqual({ action: "cancel" });
    });

    it("keeps cancellation active while an authorization request is pending", async () => {
        const pendingDecision = vi.fn();
        const decision = promptProtectedChapterPassword(
            {
                task: createDownloadTask(36),
                totalChapters: 300,
                pendingCount: 1
            },
            undefined,
            pendingDecision
        );
        const input = document.querySelector("#esj-protected-password") as HTMLInputElement;
        input.value = "fictional-password";
        (document.querySelector("#esj-protected-submit") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({
            action: "submit",
            password: "fictional-password",
            rememberPassword: false
        });

        expect(input.disabled).toBe(true);
        expect((document.querySelector("#esj-protected-submit") as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector("#esj-protected-skip") as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector("#esj-protected-skip-all") as HTMLButtonElement).disabled).toBe(true);
        (document.querySelector("#esj-protected-submit") as HTMLButtonElement).click();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(pendingDecision).not.toHaveBeenCalled();
        (document.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();

        expect(pendingDecision).toHaveBeenCalledWith({ action: "cancel" });
        closeProtectedChapterPrompt();
    });
});
