import { describe, expect, it } from "vitest";
import { runWorkerPool } from "../src/core/download/worker-pool";
import { createDeferred } from "./support";

describe("runWorkerPool", () => {
    it("processes every item once with bounded concurrency", async () => {
        const processed: number[] = [];
        let activeCount = 0;
        let maxActiveCount = 0;

        const result = await runWorkerPool({
            items: [0, 1, 2, 3, 4, 5],
            concurrency: 3,
            isCancellationRequested: () => false,
            process: async (item) => {
                activeCount += 1;
                maxActiveCount = Math.max(maxActiveCount, activeCount);
                await Promise.resolve();
                processed.push(item);
                activeCount -= 1;
            }
        });

        expect(processed.toSorted((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(maxActiveCount).toBe(3);
        expect(result).toEqual({ claimedCount: 6, completedCount: 6, cancelled: false });
    });

    it("waits for downstream work before claiming the next item", async () => {
        const downstreamReady = createDeferred<void>();
        const started: number[] = [];
        const poolPromise = runWorkerPool({
            items: [0, 1],
            concurrency: 1,
            isCancellationRequested: () => false,
            process: async (item) => {
                started.push(item);
                if (item === 0) {
                    await downstreamReady.promise;
                }
            }
        });

        await Promise.resolve();
        expect(started).toEqual([0]);
        downstreamReady.resolve();
        await poolPromise;
        expect(started).toEqual([0, 1]);
    });

    it("stops claiming new items after cancellation", async () => {
        let cancelled = false;
        const processed: number[] = [];

        const result = await runWorkerPool({
            items: [0, 1, 2],
            concurrency: 1,
            isCancellationRequested: () => cancelled,
            process: async (item) => {
                processed.push(item);
                cancelled = true;
            }
        });

        expect(processed).toEqual([0]);
        expect(result).toEqual({ claimedCount: 1, completedCount: 1, cancelled: true });
    });

    it("waits for a shared consent gate before claiming another item", async () => {
        const consent = createDeferred<boolean>();
        const processed: number[] = [];
        let claimCheckCount = 0;
        const poolPromise = runWorkerPool({
            items: [0, 1],
            concurrency: 1,
            isCancellationRequested: () => false,
            beforeClaim: () => {
                claimCheckCount += 1;
                return claimCheckCount === 1 ? Promise.resolve(true) : consent.promise;
            },
            process: async (item) => {
                processed.push(item);
            }
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(processed).toEqual([0]);

        consent.resolve(false);
        const result = await poolPromise;

        expect(processed).toEqual([0]);
        expect(result.claimedCount).toBe(1);
    });
});
