// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/core/state";
import { createDownloadButton, createRangeDownloadButton, createSettingButton } from "../../src/ui/components";
import { createConfirmPopup, createDownloadPopup, createSettingsPanel } from "../../src/ui/popups";
import { acquirePageActionGroupLock } from "../../src/ui/page-action-lock";
import { t } from "../../src/ui/locale";
import { fullCleanup } from "../../src/utils/dom";

function createPageActions() {
    const fullScrape = vi.fn(async () => undefined);
    const rangeScrape = vi.fn(async () => undefined);
    const fullButton = createDownloadButton("full", undefined, fullScrape) as HTMLButtonElement;
    const rangeButton = createRangeDownloadButton("range", rangeScrape) as HTMLButtonElement;
    const settingsButton = createSettingButton() as HTMLButtonElement;
    document.body.append(fullButton, rangeButton, settingsButton);
    return { fullButton, rangeButton, settingsButton, fullScrape, rangeScrape };
}

function expectPageActionsDisabled(disabled: boolean): void {
    const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".esj-download-trigger,.esj-settings-trigger")
    );
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.disabled === disabled)).toBe(true);
}

describe("page action popup locks", () => {
    beforeEach(() => {
        fullCleanup();
        document.body.replaceChildren();
        state.cachedData = null;
        state.globalChaptersMap.clear();
    });

    afterEach(() => {
        fullCleanup();
        document.body.replaceChildren();
    });

    it("blocks full and range downloads while settings are open, then restores every entry on close", async () => {
        const { fullButton, rangeButton, settingsButton, fullScrape, rangeScrape } = createPageActions();

        settingsButton.click();
        expect(document.querySelector("#esj-settings")).not.toBeNull();
        expectPageActionsDisabled(true);

        fullButton.click();
        rangeButton.click();
        await Promise.resolve();
        expect(fullScrape).not.toHaveBeenCalled();
        expect(rangeScrape).not.toHaveBeenCalled();

        document.querySelector<HTMLButtonElement>("#esj-settings .esj-common-header button")?.click();
        expect(document.querySelector("#esj-settings")).toBeNull();
        expectPageActionsDisabled(false);
    });

    it("keeps an outer task lock when full cleanup removes a settings popup", () => {
        createPageActions();
        const releaseTask = acquirePageActionGroupLock();
        createSettingsPanel();
        expectPageActionsDisabled(true);

        fullCleanup();
        expect(document.querySelector("#esj-settings")).toBeNull();
        expectPageActionsDisabled(true);

        releaseTask();
        expectPageActionsDisabled(false);
    });

    it("hands the page lock from confirmation to download progress until cleanup", () => {
        createPageActions();
        createConfirmPopup(() => createDownloadPopup());
        expectPageActionsDisabled(true);

        document.querySelector<HTMLButtonElement>("#esj-confirm-ok")?.click();
        expect(document.querySelector("#esj-confirm")).toBeNull();
        expect(document.querySelector("#esj-popup")).not.toBeNull();
        expectPageActionsDisabled(true);

        fullCleanup();
        expectPageActionsDisabled(false);
    });

    it("keeps page actions locked while settings hands ownership to diagnostics", () => {
        createPageActions();
        createSettingsPanel();
        const diagnosticsButton = Array.from(document.querySelectorAll<HTMLButtonElement>("#esj-settings button")).find(
            (button) => button.textContent === t("settings.diagnosticsButton")
        );

        diagnosticsButton?.click();
        expect(document.querySelector("#esj-settings")).toBeNull();
        expect(document.querySelector("#esj-diagnostics")).not.toBeNull();
        expectPageActionsDisabled(true);

        document.querySelector<HTMLButtonElement>("#esj-diagnostics .esj-common-header button")?.click();
        expectPageActionsDisabled(false);
    });

    it("releases a popup lock when external code removes its element directly", async () => {
        createPageActions();
        createSettingsPanel();
        expectPageActionsDisabled(true);

        document.querySelector("#esj-settings")?.remove();

        await vi.waitFor(() => expectPageActionsDisabled(false));
    });
});
