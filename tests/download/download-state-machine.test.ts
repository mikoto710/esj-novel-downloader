import { describe, expect, it } from "vitest";
import type { DownloadEvent } from "../../src/core/download/contracts";
import {
    canTransitionDownloadPhase,
    createInitialDownloadSnapshot,
    DownloadStateMachine
} from "../../src/core/download/state-machine";
import { RecordingDownloadEvents } from "../support";

describe("DownloadStateMachine", () => {
    it("accepts the normal download lifecycle", () => {
        const events = new RecordingDownloadEvents<DownloadEvent>();
        const machine = new DownloadStateMachine(3, 1, events);

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
        expect(canTransitionDownloadPhase("released", "cancelling")).toBe(false);
        expect(canTransitionDownloadPhase("cancelled", "downloading")).toBe(false);
    });

    it("rejects phase skips and protects its internal snapshot", () => {
        const machine = new DownloadStateMachine(3, 1, { emit: () => undefined });
        const initial = machine.snapshot;
        initial.completedCount = 99;

        expect(machine.snapshot).toEqual(createInitialDownloadSnapshot(3, 1));
        expect(() => machine.transition("downloading")).toThrow("idle -> downloading");
    });

    it("emits immutable progress snapshots", () => {
        const events = new RecordingDownloadEvents<DownloadEvent>();
        const machine = new DownloadStateMachine(2, 0, events);
        machine.transition("preparing");
        const snapshot = machine.update({ completedCount: 1, fetchedCount: 1 });
        snapshot.completedCount = 2;

        expect(machine.snapshot.completedCount).toBe(1);
        expect(events.ofType("snapshot-updated")).toHaveLength(1);
    });

    it("preserves the cancellation outcome in the terminal snapshot", () => {
        const machine = new DownloadStateMachine(1, 0, { emit: () => undefined });
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
