import { describe, expect, it, vi } from "vitest";
import { formatStorageFailure, formatStorageFailureText } from "../../src/ui/messages/storage-failure";

vi.mock("../../src/ui/locale", () => ({
    t: (key: string) =>
        ({
            "download.storage.quotaExceeded": "浏览器存储空间不足",
            "download.storage.databaseUnavailable": "IndexedDB 当前不可用",
            "download.storage.flushTimeout": "缓存写入超时"
        })[key] || key
}));

describe("storage failure messages", () => {
    it("formats a stable reason in the current locale", () => {
        expect(
            formatStorageFailure({
                reason: "quota-exceeded",
                operation: "write",
                message: "quota-exceeded:write"
            })
        ).toBe("浏览器存储空间不足");
    });

    it("keeps distinct technical detail after the localized summary", () => {
        expect(formatStorageFailureText("database-unavailable", "IndexedDB disabled")).toBe(
            "IndexedDB 当前不可用：IndexedDB disabled"
        );
    });

    it("does not duplicate detail matching the localized summary", () => {
        expect(formatStorageFailureText("flush-timeout", "缓存写入超时")).toBe("缓存写入超时");
    });

    it("keeps an unknown reason visible for forward compatibility", () => {
        expect(formatStorageFailureText("future-storage-reason")).toBe("future-storage-reason");
    });
});
