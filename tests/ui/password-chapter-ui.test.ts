// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeProtectedChapterPrompt, promptProtectedChapterPassword } from "../../src/ui/popups";
import { createDownloadTask } from "../support";
import { setInterfaceLocalePreference } from "../../src/storage/settings";
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

    it("preserves the pending password and remember choice across a locale change", async () => {
        const decision = prompt();
        const popup = document.querySelector("#esj-protected-chapter") as HTMLElement;
        const input = popup.querySelector("#esj-protected-password") as HTMLInputElement;
        const remember = popup.querySelector("#esj-protected-remember") as HTMLInputElement;
        input.value = "draft-password";
        remember.checked = true;

        setInterfaceLocalePreference("zh-TW");
        publishInterfaceLocaleChange();

        expect(document.querySelector("#esj-protected-chapter")).toBe(popup);
        expect(input.value).toBe("draft-password");
        expect(remember.checked).toBe(true);
        (popup.querySelector("#esj-protected-cancel") as HTMLButtonElement).click();
        await expect(decision).resolves.toEqual({ action: "cancel" });
    });

    it("returns cancellation and removes the prompt when the task aborts", async () => {
        const controller = new AbortController();
        const decision = prompt(controller.signal);

        controller.abort();

        await expect(decision).resolves.toEqual({ action: "cancel" });
        expect(document.querySelector("#esj-protected-chapter")).toBeNull();
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
