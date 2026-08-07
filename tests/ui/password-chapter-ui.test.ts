// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeProtectedChapterPrompt, promptProtectedChapterPassword } from "../../src/ui/popups";
import { createDownloadTask } from "../support";
import { setInterfaceLocalePreference } from "../../src/core/config";

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
        expect(popup.textContent).toContain("目录位置 37/300");
        expect(popup.textContent).toContain("密码待处理 3");
        expect((popup.querySelector("a") as HTMLAnchorElement).href).toBe("https://www.esjzone.cc/forum/100/37.html");
        expect((popup.querySelector("#esj-protected-remember") as HTMLInputElement).checked).toBe(false);

        (popup.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("renders the password prompt in traditional Chinese", async () => {
        setInterfaceLocalePreference("zh-TW");
        const decision = prompt();
        const popup = document.querySelector("#esj-protected-chapter") as HTMLElement;

        expect(popup.textContent).toContain("章節需要密碼");
        expect(popup.textContent).toContain("密碼待處理 3");
        expect(popup.textContent).toContain("不會儲存");

        (popup.querySelector("#esj-protected-skip") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "skip-current" });
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
        expect((document.querySelector("#esj-protected-submit") as HTMLButtonElement).textContent).toBe("正在验证...");
        expect((document.querySelector("#esj-protected-skip") as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector("#esj-protected-skip-all") as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector("#esj-protected-cancel") as HTMLButtonElement).disabled).toBe(false);
        closeProtectedChapterPrompt();
    });

    it("uses consistent action styles and a plaintext password field", async () => {
        const decision = prompt();
        const input = document.querySelector("#esj-protected-password") as HTMLInputElement;

        for (const selector of [
            "#esj-protected-cancel",
            "#esj-protected-skip-all",
            "#esj-protected-skip",
            "#esj-protected-submit"
        ]) {
            expect(document.querySelector(selector)?.classList).toContain("esj-protected-action");
        }
        expect((document.querySelector("#esj-protected-actions") as HTMLElement).style.flexWrap).toBe("");
        expect(input.type).toBe("text");
        expect(document.querySelector("#esj-protected-visibility")).toBeNull();

        (document.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
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

        expect(document.querySelector("#esj-protected-error")?.textContent).toBe("请输入密码。");
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

        const rejectedDecision = promptProtectedChapterPassword({
            task: createDownloadTask(36),
            totalChapters: 300,
            pendingCount: 3,
            message: "密码不正确"
        });
        expect(document.querySelector("#esj-protected-chapter")).toBe(popup);
        expect((popup.querySelector("#esj-protected-password") as HTMLInputElement).value).toBe("");
        expect(popup.querySelector("#esj-protected-error")?.textContent).toBe("密码不正确");
        (popup.querySelector("#esj-protected-skip") as HTMLButtonElement).click();
        await expect(rejectedDecision).resolves.toEqual({ action: "skip-current" });

        const reconnectDecision = promptProtectedChapterPassword({
            task: createDownloadTask(36),
            totalChapters: 300,
            pendingCount: 3,
            message: "连接失败，请检查网络后重试。",
            initialPassword: "remembered",
            rememberPassword: true,
            retryConnection: true
        });
        expect((document.querySelector("#esj-protected-submit") as HTMLButtonElement).textContent).toBe("重试连接");
        (document.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(reconnectDecision).resolves.toEqual({ action: "cancel" });
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
