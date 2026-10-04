// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { showMessagePopup } from "../../src/ui/dialogs/message";
import { showMappingFontFailure } from "../../src/ui/popups";
import { setInterfaceLocalePreference } from "../../src/core/config";

describe("message popup UI", () => {
    beforeEach(() => setInterfaceLocalePreference("zh-CN"));

    it.each(["info", "warning", "error"] as const)("exposes the %s message and accessible role", (tone) => {
        const popup = showMessagePopup({ tone, message: "Message body", details: ["First detail", "Second detail"] });

        expect(popup.dataset.tone).toBe(tone);
        expect(popup.querySelector("#esj-message-summary")?.textContent).toBe("Message body");
        expect(popup.querySelector("#esj-message-details")?.textContent).toBe("First detail\nSecond detail");
        expect(popup.getAttribute("role")).toBe(tone === "info" ? "dialog" : "alertdialog");
    });

    it("replaces an existing message and closes from either close control", () => {
        showMessagePopup({ tone: "info", message: "First message" });
        showMessagePopup({ tone: "warning", message: "Second message" });

        expect(document.querySelectorAll("#esj-message-popup")).toHaveLength(1);
        expect(document.querySelector("#esj-message-popup")?.textContent).not.toContain("First message");
        (document.querySelector("#esj-message-close") as HTMLButtonElement).click();
        expect(document.querySelector("#esj-message-popup")).toBeNull();

        showMessagePopup({ tone: "error", message: "Third message" });
        (document.querySelector("#esj-message-popup .esj-common-header button") as HTMLButtonElement).click();
        expect(document.querySelector("#esj-message-popup")).toBeNull();
    });

    it("shows a bounded mapped-font failure summary", () => {
        const failures = Array.from({ length: 7 }, (_, index) => ({
            task: { index, url: `https://example.com/${index + 1}`, title: `Chapter ${index + 1}` },
            code: "woff2-invalid" as const,
            reason: "woff2-signature-invalid" as const,
            params: {}
        }));
        showMappingFontFailure(failures);

        const popup = document.querySelector("#esj-message-popup") as HTMLElement;
        expect(popup.dataset.tone).toBe("error");
        expect(popup.textContent).toContain(failures[0].task.title);
        const listed = failures.filter((failure) => popup.textContent?.includes(failure.task.title));
        expect(listed.length).toBeLessThan(failures.length);
    });
});
