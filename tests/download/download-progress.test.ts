import { describe, expect, it, vi } from "vitest";
import {
    DownloadProgress,
    canTransitionDownloadPhase,
    createInitialDownloadSnapshot
} from "../../src/core/download/download-progress";
import { createDownloadScope } from "../../src/core/download/download-scope";
import type { DownloadEvent, DownloadEventSink } from "../../src/core/download/contracts";
import { RecordingDownloadEvents } from "../support";
import { createChapter, createDownloadTask } from "../support";

function createProgress(count: number, restored: number, events: DownloadEventSink): DownloadProgress {
    const tasks = Array.from({ length: count }, (_, index) => createDownloadTask(index));
    const scope = createDownloadScope(
        {
            bookId: "100",
            taskId: "task-100",
            bookName: "Book",
            introTxt: "",
            description: "",
            tags: [],
            imageEnabled: false,
            tasks
        },
        { fallbackPageUrl: "https://example.test", startedAt: 0 }
    );
    const chapters = new Map(tasks.slice(0, restored).map((task) => [task.index, createChapter(task.index)]));
    return new DownloadProgress(scope, chapters, events, { update: () => undefined });
}

describe("DownloadProgress", () => {
    it("derives readiness from selected chapters after additions and invalidation", () => {
        const scope = createDownloadScope(
            {
                bookId: "100",
                taskId: "range-task",
                bookName: "Range book",
                introTxt: "",
                description: "",
                tags: [],
                imageEnabled: false,
                tasks: [createDownloadTask(10), createDownloadTask(11)],
                selection: { mode: "range", sourceTotalChapters: 20, startIndex: 10, endIndex: 11 }
            },
            { fallbackPageUrl: "https://example.test/book", startedAt: 0 }
        );
        const chapters = new Map([
            [0, createChapter(0)],
            [10, createChapter(10)]
        ]);
        const ui = { update: vi.fn() };
        const progress = new DownloadProgress(scope, chapters, { emit: vi.fn() }, ui);
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
    it("accepts the normal download lifecycle", () => {
        const events = new RecordingDownloadEvents<DownloadEvent>();
        const machine = createProgress(3, 1, events);

        for (const phase of [
            "preparing",
            "restoring-cache",
            "downloading",
            "flushing-cache",
            "checking-integrity",
            "flushing-cache",
            "preparing-export",
            "export-ready"
        ] as const) {
            machine.transition(phase);
        }

        expect(machine.snapshot.phase).toBe("export-ready");
        expect(events.ofType("phase-changed")).toHaveLength(8);
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

        expect(machine.snapshot).toEqual(createInitialDownloadSnapshot(3, 1));
        expect(() => machine.transition("downloading")).toThrow("idle -> downloading");
    });

    it("emits immutable progress snapshots", () => {
        const events = new RecordingDownloadEvents<DownloadEvent>();
        const machine = createProgress(2, 0, events);
        machine.transition("preparing");
        machine.update({ completedCount: 1, fetchedCount: 1 });
        const snapshot = machine.snapshot;
        snapshot.completedCount = 2;

        expect(machine.snapshot.completedCount).toBe(1);
        expect(events.ofType("snapshot-updated")).toHaveLength(1);
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
