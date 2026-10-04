import { describe, expect, it, vi } from "vitest";
import { formatStorageFailure, formatStorageFailureText } from "../../src/ui/messages/storage-failure";

vi.mock("../../src/ui/locale", () => ({ t: (key: string) => key }));

describe("storage failure messages", () => {
    it("maps a classified reason without leaking its internal operation", () => {
        expect(
            formatStorageFailure({ reason: "quota-exceeded", operation: "write", message: "quota-exceeded:write" })
        ).toBe("download.storage.quotaExceeded");
    });

    it("keeps distinct technical detail after the summary", () => {
        expect(formatStorageFailureText("database-unavailable", "IndexedDB disabled")).toBe(
            "download.storage.databaseUnavailable：IndexedDB disabled"
        );
    });

    it("does not duplicate detail matching the summary", () => {
        const summary = "download.storage.flushTimeout";
        expect(formatStorageFailureText("flush-timeout", summary)).toBe(summary);
    });

    it("keeps an unknown reason visible for forward compatibility", () => {
        expect(formatStorageFailureText("future-storage-reason")).toBe("future-storage-reason");
    });
});
