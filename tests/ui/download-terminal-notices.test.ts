import { describe, expect, it, vi } from "vitest";
import { showCacheDiscardFailure, showDownloadTerminalFailure } from "../../src/ui/messages/download-terminal";
import { showMessagePopup } from "../../src/ui/dialogs/message";

vi.mock("../../src/ui/locale", () => ({ t: (key: string) => key }));
vi.mock("../../src/ui/dialogs/message", () => ({ showMessagePopup: vi.fn() }));

describe("download terminal notices", () => {
    it("passes unexpected failures and their technical detail to the common popup", () => {
        showDownloadTerminalFailure({
            kind: "download",
            code: "Error",
            params: { errorName: "Error", detail: "parser failed" },
            storageFailure: null
        });

        expect(showMessagePopup).toHaveBeenCalledWith(
            expect.objectContaining({
                tone: "error",
                title: "download.terminal.failed.title",
                details: expect.stringContaining("parser failed")
            })
        );
    });

    it("keeps cancellation timeout distinct from a saved stop", () => {
        showDownloadTerminalFailure({
            kind: "cancellation",
            outcome: "save-timed-out",
            storageFailure: { reason: "flush-timeout", operation: "flush", message: "flush-timeout:flush" }
        });

        expect(showMessagePopup).toHaveBeenCalledWith(
            expect.objectContaining({
                tone: "error",
                title: "download.terminal.saveTimeout.title",
                message: "download.terminal.saveTimeout.message",
                details: expect.stringContaining("flush-timeout")
            })
        );
    });

    it("keeps cache discard failure distinct from cancellation itself", () => {
        showCacheDiscardFailure({
            reason: "transaction-aborted",
            operation: "clear",
            message: "transaction-aborted:clear"
        });

        expect(showMessagePopup).toHaveBeenCalledWith(
            expect.objectContaining({
                tone: "error",
                title: "download.terminal.discardFailed.title",
                details: expect.stringContaining("transaction-aborted")
            })
        );
    });
});
