import { describe, expect, it } from "vitest";
import { runDownload } from "../../src/core/download/coordinator";
import type { DownloadPhase, DownloadSnapshot } from "../../src/core/download/contracts";
import { createDeferred, createDownloadTask } from "../support";
import { createStressDownloadHarness, createStressDownloadOptions } from "./download-stress-harness";

describe("download resilience pressure", () => {
    it("bounds work claimed while a slow cache write applies backpressure", async () => {
        const tasks = Array.from({ length: 300 }, (_, index) => createDownloadTask(index));
        const firstWriteStarted = createDeferred<void>();
        const releaseFirstWrite = createDeferred<boolean>();
        let writeCount = 0;
        const harness = createStressDownloadHarness({
            tasks,
            concurrency: 5,
            putBatch: async () => {
                writeCount += 1;
                if (writeCount === 1) {
                    firstWriteStarted.resolve();
                    return releaseFirstWrite.promise;
                }
                return true;
            }
        });

        const downloadPromise = runDownload(createStressDownloadOptions(tasks), harness.dependencies);
        await firstWriteStarted.promise;
        await Promise.resolve();

        expect(harness.processedIndexes.length).toBeGreaterThanOrEqual(25);
        expect(harness.processedIndexes.length).toBeLessThanOrEqual(125);
        expect(harness.processedIndexes.length).toBeLessThan(300);

        releaseFirstWrite.resolve(true);
        await downloadPromise;

        expect(harness.processedIndexes).toHaveLength(300);
        expect(harness.persistedIndexes).toHaveLength(300);
        expect(Math.max(...harness.persistedBatches.map((batch) => batch.length))).toBe(25);
    });

    it.each([
        { name: "cache restoration", phase: "restoring-cache" as const },
        { name: "active download", phase: "downloading" as const, minimumCompleted: 50 },
        { name: "cache flush", phase: "flushing-cache" as const },
        { name: "integrity scan", phase: "checking-integrity" as const },
        { name: "export preparation", phase: "preparing-export" as const }
    ])("settles cancellation during $name", async ({ phase, minimumCompleted }) => {
        const tasks = Array.from({ length: 300 }, (_, index) => createDownloadTask(index));
        const harness = createStressDownloadHarness({ tasks, concurrency: 5 });
        const originalUpdate = harness.dependencies.ui.update.bind(harness.dependencies.ui);
        let cancellationTriggered = false;
        harness.dependencies.ui.update = (snapshot) => {
            originalUpdate(snapshot);
            if (!cancellationTriggered && shouldCancelAtSnapshot(snapshot, phase, minimumCompleted)) {
                cancellationTriggered = true;
                harness.requestCancellation("flush");
            }
        };

        await runDownload(createStressDownloadOptions(tasks), harness.dependencies);

        expect(cancellationTriggered).toBe(true);
        expect(harness.snapshots.at(-1)).toMatchObject({
            phase: "cancelled",
            cancellationRequested: true,
            hasExportData: false
        });
        expect(harness.exportData).toBeNull();
        expect(harness.dependencies.ui.showFormatChoice).not.toHaveBeenCalled();
        if (phase === "downloading") {
            expect(harness.fetchedIndexes.length).toBeGreaterThanOrEqual(50);
            expect(harness.fetchedIndexes.length).toBeLessThan(300);
        }
    });
});

function shouldCancelAtSnapshot(snapshot: DownloadSnapshot, phase: DownloadPhase, minimumCompleted?: number): boolean {
    if (snapshot.phase !== phase) {
        return false;
    }
    return minimumCompleted === undefined || snapshot.completedCount >= minimumCompleted;
}
