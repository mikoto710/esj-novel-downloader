// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/core/state";
import { createDownloadButton, createSettingButton } from "../../src/ui/components";
import { createDownloadPopup, createSettingsPanel } from "../../src/ui/popups";
import { acquirePageActionGroupLock } from "../../src/ui/page-action-lock";
import { t } from "../../src/ui/locale";
import { fullCleanup } from "../../src/utils/dom";
import { createDownloadSelectionPopup } from "../../src/ui/dialogs/download-selection";
import { createDownloadTask } from "../support";

function createPageActions(download: () => Promise<void> = async () => undefined) {
    const scrape = vi.fn(download);
    const downloadButton = createDownloadButton("download", undefined, scrape) as HTMLButtonElement;
    const settingsButton = createSettingButton() as HTMLButtonElement;
    document.body.append(downloadButton, settingsButton);
    return { downloadButton, settingsButton, scrape };
}

function expectPageActionsDisabled(disabled: boolean): void {
    const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".esj-download-trigger,.esj-settings-trigger")
    );
    expect(buttons).toHaveLength(2);
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

    it("blocks download while settings are open, then restores both entries on close", async () => {
        const { downloadButton, settingsButton, scrape } = createPageActions();

        settingsButton.click();
        expect(document.querySelector("#esj-settings")).not.toBeNull();
        expectPageActionsDisabled(true);

        downloadButton.click();
        await Promise.resolve();
        expect(scrape).not.toHaveBeenCalled();

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

    it("hands the page lock from download selection to progress until cleanup", async () => {
        const { downloadButton } = createPageActions(async () => {
            const decision = await createDownloadSelectionPopup({
                tasks: [createDownloadTask(0)],
                cachedIndexes: new Set(),
                cacheCount: 0,
                cacheWillBeInvalidated: false,
                imageEnabled: false,
                hasExistingExport: false
            });
            if (decision.action === "download") {
                createDownloadPopup();
            }
        });
        downloadButton.click();
        expectPageActionsDisabled(true);

        document.querySelector<HTMLButtonElement>("#esj-range-download")?.click();
        await vi.waitFor(() => expect(document.querySelector("#esj-popup")).not.toBeNull());
        expect(document.querySelector("#esj-range-selection")).toBeNull();
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
