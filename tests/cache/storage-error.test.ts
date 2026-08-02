import { describe, expect, it } from "vitest";
import {
    isExpectedStorageCancellation,
    normalizeStorageError,
    StorageError,
    toStorageFailure
} from "../../src/core/cache/storage-error";

describe("storage error classification", () => {
    it("classifies quota failures", () => {
        const error = normalizeStorageError(new DOMException("storage full", "QuotaExceededError"), "write");

        expect(toStorageFailure(error)).toMatchObject({ reason: "quota-exceeded", operation: "write" });
    });

    it("classifies unexpected transaction aborts", () => {
        const error = normalizeStorageError(new DOMException("transaction aborted", "AbortError"), "write");

        expect(error.reason).toBe("transaction-aborted");
    });

    it("classifies unavailable IndexedDB environments", () => {
        const error = normalizeStorageError(new ReferenceError("indexedDB is not defined"), "read");

        expect(error.reason).toBe("database-unavailable");
    });

    it("retains the underlying reason when migration fails", () => {
        const error = normalizeStorageError(new DOMException("storage full", "QuotaExceededError"), "migrate", {
            migration: true
        });

        expect(error).toBeInstanceOf(StorageError);
        expect(toStorageFailure(error)).toMatchObject({
            reason: "migration-failed",
            operation: "migrate",
            causeReason: "quota-exceeded"
        });
    });

    it("does not classify a signal-driven abort as a storage failure", () => {
        const controller = new AbortController();
        controller.abort();

        expect(isExpectedStorageCancellation(new DOMException("cancelled", "AbortError"), controller.signal)).toBe(
            true
        );
    });
});
