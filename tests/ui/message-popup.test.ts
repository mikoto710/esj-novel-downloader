// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { showMessagePopup } from "../../src/ui/dialogs/message";
import { showMappingFontFailure } from "../../src/ui/popups";
import { setInterfaceLocalePreference } from "../../src/core/config";

describe("message popup UI", () => {
    beforeEach(() => setInterfaceLocalePreference("zh-CN"));

    it.each([
        ["info", "ℹ️"],
        ["warning", "⚠️"],
        ["error", "❌"]
    ] as const)("renders the %s presentation with the shared header", (tone, icon) => {
        const popup = showMessagePopup({ tone, message: "Message body" });

        expect(popup.dataset.tone).toBe(tone);
        expect(popup.querySelector(".esj-common-header")?.textContent).toContain(icon);
        expect(popup.querySelector("#esj-message-summary")?.textContent).toBe("Message body");
        expect(popup.getAttribute("role")).toBe(tone === "info" ? "dialog" : "alertdialog");
        expect(popup.style.width).toBe("380px");
        expect(popup.style.fontFamily).toBe("");
        expect((popup.children[1] as HTMLElement).style.fontSize).toBe("15px");
        const closeButton = popup.querySelector("#esj-message-close") as HTMLButtonElement;
        expect(closeButton.style.background).toBe("rgb(238, 238, 238)");
        expect(closeButton.getAttribute("style")).toBe(
            "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;"
        );
    });

    it("replaces an existing message and closes from either close control", () => {
        showMessagePopup({ tone: "info", message: "First message" });
        showMessagePopup({ tone: "warning", message: "Second message" });

        expect(document.querySelectorAll("#esj-message-popup")).toHaveLength(1);
        expect(document.querySelector("#esj-message-popup")?.textContent).not.toContain("First message");
        (document.querySelector("#esj-message-close") as HTMLButtonElement).click();
        expect(document.querySelector("#esj-message-popup")).toBeNull();

        showMessagePopup({ tone: "error", message: "Third message" });
        (document.querySelector("#esj-message-close") as HTMLButtonElement).click();
        expect(document.querySelector("#esj-message-popup")).toBeNull();
    });

    it("keeps long multiline details in a separately scrollable region", () => {
        showMessagePopup({
            tone: "error",
            title: "Detailed failure",
            message: "The operation failed.",
            details: ["First detail", "Second detail"]
        });

        const details = document.querySelector("#esj-message-details") as HTMLElement;
        expect(details.textContent).toBe("First detail\nSecond detail");
        expect(details.style.overflow).toBe("auto");
        expect(details.style.maxHeight).toBe("220px");
        expect(details.style.fontSize).toBe("13px");
        expect((document.querySelector("#esj-message-popup") as HTMLElement).style.width).toBe("440px");
    });

    it("shows a bounded mapped-font failure summary", () => {
        showMappingFontFailure(
            Array.from({ length: 7 }, (_, index) => ({
                task: { index, url: `https://example.com/${index + 1}`, title: `Chapter ${index + 1}` },
                code: "woff2-invalid" as const,
                reason: "woff2-signature-invalid" as const,
                params: {}
            }))
        );

        const popup = document.querySelector("#esj-message-popup") as HTMLElement;
        expect(popup.textContent).toContain("有 7 个章节");
        expect(popup.textContent).toContain("Chapter 5");
        expect(popup.textContent).not.toContain("Chapter 6");
        expect(popup.textContent).toContain("另有 2 章未列出");
    });
});
