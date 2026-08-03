import { describe, expect, it } from "vitest";
import {
    createEmptyDiagnosticStore,
    createDiagnosticSessionView,
    DiagnosticManager,
    DIAGNOSTIC_CLOSE_UNCONFIRMED_MS,
    DIAGNOSTIC_HISTORY_LIMIT,
    DIAGNOSTIC_RETENTION_MS,
    DIAGNOSTIC_SESSION_BYTES_LIMIT,
    sanitizeDiagnosticMessage,
    sanitizeDiagnosticUrl,
    type DiagnosticRepository,
    type DiagnosticStore,
    type StartDiagnosticSessionInput
} from "../../src/core/diagnostics";
import { createInitialDownloadSnapshot } from "../../src/core/download/state-machine";

class MemoryDiagnosticRepository implements DiagnosticRepository {
    store = createEmptyDiagnosticStore();

    load(): DiagnosticStore {
        return structuredClone(this.store);
    }

    save(store: DiagnosticStore): void {
        this.store = structuredClone(store);
    }
}

class InterleavingDiagnosticRepository extends MemoryDiagnosticRepository {
    onLoad: (() => void) | null = null;

    load(): DiagnosticStore {
        const snapshot = super.load();
        const onLoad = this.onLoad;
        this.onLoad = null;
        onLoad?.();
        return snapshot;
    }
}

function createInput(
    taskId: string,
    overrides: Partial<StartDiagnosticSessionInput> = {}
): StartDiagnosticSessionInput {
    return {
        taskId,
        bookId: `book-${taskId}`,
        bookTitle: `Book ${taskId}`,
        pageUrl: `https://www.esjzone.cc/detail/${taskId}.html?token=secret#chapter`,
        sourcePageType: "detail",
        totalChapters: 12,
        application: {
            version: "1.5.0-beta.2",
            browser: "Chrome 140",
            userscriptManager: "Tampermonkey 5"
        },
        settings: { concurrency: 5, imageEnabled: true, epubTagPageEnabled: false },
        ...overrides
    };
}

describe("diagnostic session retention", () => {
    it("does not overwrite another page's terminal result while listing a stale snapshot", () => {
        const repository = new InterleavingDiagnosticRepository();
        const writer = new DiagnosticManager(repository, () => 1_000);
        const reader = new DiagnosticManager(repository, () => 1_000);
        writer.start(createInput("concurrent"));

        repository.onLoad = () => {
            writer.finish("concurrent", "success");
        };

        expect(reader.list().active).toEqual([expect.objectContaining({ taskId: "concurrent" })]);
        expect(repository.store.history).toEqual([
            expect.objectContaining({ taskId: "concurrent", result: "success" })
        ]);
        expect(reader.list().history).toEqual([expect.objectContaining({ taskId: "concurrent", result: "success" })]);
    });

    it("keeps a page-close observation nonterminal when a real outcome arrives", () => {
        const repository = new MemoryDiagnosticRepository();
        let now = 1_000;
        const manager = new DiagnosticManager(repository, () => now);
        manager.start(createInput("closed"));

        now = 2_000;
        manager.markCloseObserved("closed");
        manager.finish("closed", "success");

        expect(manager.list().history).toEqual([
            expect.objectContaining({ taskId: "closed", result: "success", closeObservedAt: 2_000 })
        ]);
    });

    it("derives replacement and interruption views without rewriting the active record", () => {
        const repository = new MemoryDiagnosticRepository();
        let now = 1_000;
        const manager = new DiagnosticManager(repository, () => now);
        manager.start(createInput("closed", { bookId: "book-1" }));

        now = 2_000;
        manager.markCloseObserved("closed");
        now = 3_000;
        manager.start(createInput("replacement", { bookId: "book-1" }));
        const preparing = { ...createInitialDownloadSnapshot(12, 0), phase: "preparing" as const };
        manager.recordDownloadEvent("replacement", {
            type: "phase-changed",
            previous: "idle",
            current: "preparing",
            snapshot: preparing
        });

        expect(createDiagnosticSessionView(manager.list(), now).unconfirmed).toEqual([
            expect.objectContaining({
                session: expect.objectContaining({ taskId: "closed", result: "running" }),
                presentation: "superseded"
            })
        ]);

        now = 2_000 + DIAGNOSTIC_CLOSE_UNCONFIRMED_MS;
        const view = createDiagnosticSessionView(manager.list(), now);
        expect(view.unconfirmed).toEqual([]);
        expect(view.history).toContainEqual(
            expect.objectContaining({
                session: expect.objectContaining({ taskId: "closed", result: "running" }),
                presentation: "interrupted"
            })
        );
        expect(repository.store.active).toContainEqual(
            expect.objectContaining({ taskId: "closed", result: "running", closeObservedAt: 2_000 })
        );
    });

    it("keeps ten completed sessions and evicts older successful sessions first", () => {
        const repository = new MemoryDiagnosticRepository();
        let now = 1_000;
        const manager = new DiagnosticManager(repository, () => now);

        for (let index = 0; index < 8; index++) {
            manager.start(createInput(`failed-${index}`));
            manager.finish(`failed-${index}`, "failed");
            now++;
        }
        for (let index = 0; index < 4; index++) {
            manager.start(createInput(`success-${index}`));
            manager.finish(`success-${index}`, "success");
            now++;
        }

        const history = manager.list().history;
        expect(history).toHaveLength(DIAGNOSTIC_HISTORY_LIMIT);
        expect(history.filter((session) => session.result === "failed")).toHaveLength(8);
        expect(history.filter((session) => session.result === "success").map((session) => session.taskId)).toEqual([
            "success-3",
            "success-2"
        ]);
    });

    it("expires old history and converts stale active sessions to interrupted records", () => {
        const repository = new MemoryDiagnosticRepository();
        let now = 1_000;
        const manager = new DiagnosticManager(repository, () => now);

        manager.start(createInput("finished"));
        manager.finish("finished", "success");
        manager.start(createInput("stale"));
        now += 2 * 24 * 60 * 60 * 1000;

        const interrupted = manager.list();
        expect(interrupted.active).toEqual([]);
        expect(interrupted.history.map((session) => [session.taskId, session.result])).toEqual([
            ["stale", "interrupted"],
            ["finished", "success"]
        ]);

        now += DIAGNOSTIC_RETENTION_MS;
        expect(manager.list().history).toEqual([]);
    });

    it("bounds one session while retaining structured failures", () => {
        const repository = new MemoryDiagnosticRepository();
        const manager = new DiagnosticManager(repository, () => 1_000);
        manager.start(createInput("large"));
        manager.recordFailure("large", {
            scope: "chapter",
            stage: "fetch",
            code: "network-error",
            message: "failure",
            chapter: { index: 4, title: "Chapter", url: "https://www.esjzone.cc/forum/1/5.html" }
        });
        for (let index = 0; index < 160; index++) {
            manager.recordLog("large", `${index}-${"x".repeat(2_000)}`);
        }

        const session = manager.list().active[0];
        expect(new TextEncoder().encode(JSON.stringify(session)).byteLength).toBeLessThanOrEqual(
            DIAGNOSTIC_SESSION_BYTES_LIMIT
        );
        expect(session.failures).toHaveLength(1);
        expect(session.failures[0].chapter).toEqual({
            index: 5,
            title: "Chapter",
            url: "https://www.esjzone.cc/forum/1/5.html"
        });
    });

    it("records bounded multi-format export outcomes after a task completes", () => {
        const repository = new MemoryDiagnosticRepository();
        const manager = new DiagnosticManager(repository, () => 1_000);
        manager.start(createInput("exports"));
        manager.finish("exports", "success");

        manager.recordExport("exports", {
            scope: "full",
            format: "epub",
            outcome: "failed",
            generated: true,
            downloadTriggered: false,
            failureStage: "download"
        });
        manager.recordExport("exports", {
            scope: "full",
            format: "epub",
            outcome: "success",
            generated: true,
            downloadTriggered: true,
            failureStage: null
        });
        manager.recordExport("exports", {
            scope: "full",
            format: "html",
            outcome: "cancelled",
            generated: false,
            downloadTriggered: false,
            failureStage: null
        });

        expect(manager.list().history[0].exports).toEqual([
            expect.objectContaining({ format: "epub", outcome: "failed", failureStage: "download" }),
            expect.objectContaining({ format: "epub", outcome: "success", downloadTriggered: true }),
            expect.objectContaining({ format: "html", outcome: "cancelled", generated: false })
        ]);
    });

    it("records the explicit incomplete chapter decision", () => {
        const repository = new MemoryDiagnosticRepository();
        const manager = new DiagnosticManager(repository, () => 1_000);
        manager.start(createInput("incomplete"));

        manager.recordDownloadEvent("incomplete", {
            type: "incomplete-chapters-decided",
            missingCount: 2,
            decision: "export-with-placeholders"
        });

        expect(manager.list().active[0].events.at(-1)).toEqual({
            at: 0,
            type: "incomplete-chapters-decided",
            details: { missingCount: 2, decision: "export-with-placeholders" }
        });
    });

    it("removes query strings, fragments and non-http protocols from exported URLs", () => {
        expect(sanitizeDiagnosticUrl("https://www.esjzone.cc/forum/1/2.html?token=secret#content")).toBe(
            "https://www.esjzone.cc/forum/1/2.html"
        );
        expect(sanitizeDiagnosticUrl("data:text/html,secret")).toBe("");
        expect(
            sanitizeDiagnosticMessage(
                "request https://www.esjzone.cc/forum/1/2.html?token=secret Cookie=session Authorization=BearerSecret data:text/plain;base64,secret"
            )
        ).toBe(
            "request https://www.esjzone.cc/forum/1/2.html Cookie=[已移除] Authorization=[已移除] [data URI 已移除]"
        );
    });

    it("repairs legacy failed records that reached export-ready without failures", () => {
        const repository = new MemoryDiagnosticRepository();
        const manager = new DiagnosticManager(repository, () => 1_000);
        manager.start(createInput("legacy-success"));
        manager.finish("legacy-success", "success");
        repository.store.history[0].result = "failed";
        repository.store.history[0].task.phase = "export-ready";
        repository.store.history[0].task.completedChapters = 12;
        delete (repository.store.history[0] as Partial<(typeof repository.store.history)[number]>).exports;

        const session = manager.list().history[0];
        expect(session.result).toBe("success");
        expect(session.failures).toEqual([]);
        expect(session.exports).toEqual([]);
    });
});
