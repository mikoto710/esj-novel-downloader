import { describe, expect, it, vi } from "vitest";
import { runWithRetry } from "../../src/core/download/retry-policy";

describe("runWithRetry", () => {
    it("uses the configured attempts and backoff delays", async () => {
        const operation = vi.fn().mockRejectedValueOnce(new Error("first")).mockResolvedValue("ok");
        const sleep = vi.fn().mockResolvedValue(undefined);

        const result = await runWithRetry({
            policy: { maxAttempts: 3, getDelayMs: (attempt) => attempt * 100 },
            operation,
            sleep,
            isCancellationRequested: () => false
        });

        expect(result).toEqual({ status: "success", value: "ok", attempts: 2 });
        expect(operation).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(100);
    });

    it("returns the final error after exhausting attempts", async () => {
        const error = new Error("failed");
        const sleep = vi.fn().mockResolvedValue(undefined);

        const result = await runWithRetry({
            policy: { maxAttempts: 2, getDelayMs: () => 10 },
            operation: async () => Promise.reject(error),
            sleep,
            isCancellationRequested: () => false
        });

        expect(result).toEqual({ status: "failed", error, attempts: 2 });
        expect(sleep).toHaveBeenCalledOnce();
    });

    it("does not start another attempt after cancellation", async () => {
        let cancelled = false;
        const operation = vi.fn(async () => {
            cancelled = true;
            throw new Error("aborted");
        });

        const result = await runWithRetry({
            policy: { maxAttempts: 3, getDelayMs: () => 10 },
            operation,
            sleep: async () => undefined,
            isCancellationRequested: () => cancelled
        });

        expect(result).toEqual({ status: "cancelled", attempts: 1 });
        expect(operation).toHaveBeenCalledOnce();
    });
});
