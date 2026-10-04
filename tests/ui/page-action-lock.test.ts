// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/core/state";
import { createDownloadButton, createSettingButton } from "../../src/ui/components";
import { createDownloadPopup, createSettingsPanel } from "../../src/ui/popups";
import { acquirePageActionGroupLock } from "../../src/ui/page-action-lock";
import { fullCleanup } from "../../src/utils/dom";
import { createDownloadSelectionPopup } from "../../src/ui/dialogs/download-selection";
import { createDownloadTask } from "../support";

function createPageActions(download: () => Promise<void> = async () => undefined) {
    const downloadButton = createDownloadButton("download", undefined, download) as HTMLButtonElement;
    const settingsButton = createSettingButton() as HTMLButtonElement;
    document.body.append(downloadButton, settingsButton);
    return { downloadButton, settingsButton };
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
    });

    afterEach(() => {
        fullCleanup();
        document.body.replaceChildren();
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

    it("releases a popup lock when external code removes its element directly", async () => {
        createPageActions();
        createSettingsPanel();
        expectPageActionsDisabled(true);

        document.querySelector("#esj-settings")?.remove();

        await vi.waitFor(() => expectPageActionsDisabled(false));
    });
});
