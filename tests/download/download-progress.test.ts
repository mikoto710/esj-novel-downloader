import { describe, expect, it, vi } from "vitest";
import { DownloadProgress, canTransitionDownloadPhase } from "../../src/download/progress";
import { createDownloadPlan } from "../../src/download/plan";
import type { DownloadEventSink } from "../../src/download/contracts";
import { createChapter, createDownloadTask } from "../support";

function createProgress(count: number, restored: number, events: DownloadEventSink): DownloadProgress {
    const tasks = Array.from({ length: count }, (_, index) => createDownloadTask(index));
    const plan = createDownloadPlan({
        tasks
    });
    const chapters = new Map(tasks.slice(0, restored).map((task) => [task.index, createChapter(task.index)]));
    return new DownloadProgress(plan, chapters, events, { update: () => undefined });
}

describe("DownloadProgress", () => {
    it("derives readiness from selected chapters after additions and invalidation", () => {
        const plan = createDownloadPlan({
            tasks: [createDownloadTask(10), createDownloadTask(11)],
            selection: { mode: "range", sourceTotalChapters: 20, startIndex: 10, endIndex: 11 }
        });
        const chapters = new Map([
            [0, createChapter(0)],
            [10, createChapter(10)]
        ]);
        const ui = { update: vi.fn() };
        const progress = new DownloadProgress(plan, chapters, { emit: vi.fn() }, ui);
        expect(progress.snapshot).toMatchObject({ readyChapterCount: 1 });

        chapters.set(11, createChapter(11));
        chapters.set(19, createChapter(19));
        progress.update({ processedCount: 1 });
        expect(ui.update).toHaveBeenLastCalledWith(expect.objectContaining({ readyChapterCount: 2 }));

        chapters.delete(10);
        progress.update({ failedCount: 1 });
        expect(ui.update).toHaveBeenLastCalledWith(expect.objectContaining({ readyChapterCount: 1 }));
        expect(chapters.size).toBe(3);
    });

    it("allows cancellation and failure only from running states", () => {
        expect(canTransitionDownloadPhase("downloading", "cancelling")).toBe(true);
        expect(canTransitionDownloadPhase("preparing-export", "failed")).toBe(true);
        expect(canTransitionDownloadPhase("export-ready", "cancelling")).toBe(false);
        expect(canTransitionDownloadPhase("cancelled", "downloading")).toBe(false);
    });

    it("rejects phase skips and protects its internal snapshot", () => {
        const machine = createProgress(3, 1, { emit: () => undefined });
        const initial = machine.snapshot;
        initial.completedCount = 99;

        expect(machine.snapshot).toMatchObject({
            phase: "idle",
            scheduledCount: 3,
            restoredCount: 1,
            completedCount: 0
        });
        expect(() => machine.transition("downloading")).toThrow("idle -> downloading");
    });

    it("preserves the cancellation outcome in the terminal snapshot", () => {
        const machine = createProgress(1, 0, { emit: () => undefined });
        machine.transition("preparing");
        machine.transition("restoring-cache");
        machine.transition("downloading");
        machine.update({ cancellationRequested: true, cancellationOutcome: "save-timed-out" });
        machine.transition("cancelling");
        machine.transition("cancelled");

        expect(machine.snapshot).toMatchObject({
            phase: "cancelled",
            cancellationRequested: true,
            cancellationOutcome: "save-timed-out"
        });
    });
});
