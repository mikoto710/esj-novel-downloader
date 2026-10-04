import { describe, expect, it, vi } from "vitest";
import { formatDownloadLog } from "../../src/adapters/browser-download-messages";

const { translate } = vi.hoisted(() => ({
    translate: vi.fn((key: string, _params?: Record<string, unknown>) => key)
}));
vi.mock("../../src/ui/locale", () => ({ t: translate }));

describe("browser download messages", () => {
    it("passes restored counts to the presentation boundary", () => {
        const message = formatDownloadLog({ code: "cache-restored", params: { count: 3 } });
        expect(message).toBe("download.log.cacheRestored");
        expect(translate).toHaveBeenCalledWith("download.log.cacheRestored", { count: 3 });
    });

    it("composes image progress from structured chapter data", () => {
        const url = "https://www.esjzone.cc/forum/1/2.html";
        const message = formatDownloadLog({
            code: "chapter-processed-with-images",
            params: { completed: 2, total: 5, title: "Chapter two", url, imageCount: 4 }
        });
        expect(message).toBe("download.log.chapterProcessedImages");
        expect(translate).toHaveBeenCalledWith("download.log.chapterProcessedBase", {
            completed: "2",
            total: "5",
            title: "Chapter two",
            url
        });
        expect(translate).toHaveBeenCalledWith("download.log.chapterProcessedImages", {
            base: "download.log.chapterProcessedBase",
            count: "4",
            url
        });
    });

    it("maps integrity reasons before interpolation", () => {
        const message = formatDownloadLog({
            code: "chapter-integrity-retry",
            params: { index: 1, total: 3, reason: "invalid-image-media-type" }
        });
        expect(message).toBe("download.log.integrityRetry");
        expect(translate).toHaveBeenCalledWith(
            "download.log.integrityRetry",
            expect.objectContaining({
                index: "1",
                total: "3",
                reason: "download.log.integrityReasonInvalidImage"
            })
        );
    });

    it("keeps the source chapter identity in protected logs", () => {
        const message = formatDownloadLog({
            code: "protected-chapter-password-rejected",
            params: { index: 2, total: 7, title: "Protected chapter" }
        });
        expect(message).toBe("protected.log.passwordRejected");
        expect(translate).toHaveBeenCalledWith("protected.log.passwordRejected", {
            chapter: expect.stringContaining("Protected chapter")
        });
        expect(translate.mock.calls[0][1]?.chapter).toContain("2/7");
    });

    it("retains the classified storage reason and technical detail", () => {
        const message = formatDownloadLog({
            code: "download-storage-failed",
            params: { reason: "quota-exceeded", detail: "storage full" }
        });
        expect(message).toBe("download.log.storageFailed");
        expect(translate).toHaveBeenCalledWith("download.log.storageFailed", {
            detail: expect.stringContaining("download.storage.quotaExceeded")
        });
        expect(translate.mock.calls.at(-1)?.[1]?.detail).toContain("storage full");
    });

    it("returns the successful message for a saved stop", () => {
        const message = formatDownloadLog({ code: "cancellation-finished", params: { outcome: "saved" } });
        expect(message).toBe("download.log.cancelledSaved");
    });
});
