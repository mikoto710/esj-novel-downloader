import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIAGNOSTIC_SCHEMA_VERSION, type DiagnosticSession } from "../../src/diagnostics/manager";
import { IndexedDbDiagnosticRepository } from "../../src/storage/diagnostics";
import { getUserscriptApiMocks } from "../support/gm";
import { deleteTestDatabase } from "../support/resources";

const ccOrigin = "https://www.esjzone.cc";
const oneOrigin = "https://www.esjzone.one";
const legacyKey = "esj_diagnostic_sessions_v1";
const now = 10_000;
let factory: IDBFactory;

function createSession(taskId: string, origin = ccOrigin): DiagnosticSession {
    return {
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
        id: `session-${taskId}`,
        taskId,
        startedAt: now - 2,
        updatedAt: now - 1,
        endedAt: now - 1,
        result: "success",
        book: { bookId: "1", title: "Example", url: `${origin}/detail/1.html`, sourcePageType: "detail" },
        application: { version: "1.5.3", browser: "Chrome", userscriptManager: "Tampermonkey" },
        settings: { concurrency: 1, imageEnabled: false, epubTagPageEnabled: false },
        task: {
            phase: "export-ready",
            totalChapters: 1,
            restoredChapters: 0,
            fetchedChapters: 1,
            processedChapters: 1,
            persistedChapters: 1,
            completedChapters: 1,
            readyChapters: 1,
            protectedDetectedChapters: 0,
            protectedPendingChapters: 0,
            protectedResolvedChapters: 0,
            protectedSkippedChapters: 0,
            failedChapters: 0,
            retryPendingChapters: 0,
            cacheWriteCount: 1,
            cacheWriteFailureCount: 0,
            mappingFontChapterCount: 0,
            mappingFontBytes: 0,
            cancellationOutcome: null,
            storageFailureCode: null
        },
        logs: [],
        events: [],
        exports: [],
        failures: []
    };
}

function seedLegacy(...history: DiagnosticSession[]): void {
    getUserscriptApiMocks().values.set(legacyKey, { schemaVersion: 1, active: [], history });
}

function repository(origin = ccOrigin, databaseFactory = factory): IndexedDbDiagnosticRepository {
    return new IndexedDbDiagnosticRepository(
        () => origin,
        () => databaseFactory
    );
}

async function deleteDatabases(databaseFactory: IDBFactory): Promise<void> {
    for (const database of await databaseFactory.databases()) {
        await deleteTestDatabase(database.name!, databaseFactory);
    }
}

describe("diagnostic session database", () => {
    beforeEach(() => {
        factory = new IDBFactory();
    });

    afterEach(async () => {
        await deleteDatabases(factory);
    });

    it("imports matching legacy sessions once per origin and does not reimport after clear", async () => {
        const ccRecord = createSession("cc-legacy");
        const oneRecord = createSession("one-legacy", oneOrigin);
        const unknownRecord = createSession("unknown");
        unknownRecord.book.url = "/detail/1.html";
        seedLegacy(ccRecord, oneRecord, unknownRecord);

        const cc = repository();
        const secondTab = repository();
        const oneFactory = new IDBFactory();
        try {
            const [first, second] = await Promise.all([cc.list(now), secondTab.list(now)]);
            expect(first.map((session) => session.taskId)).toEqual(["cc-legacy"]);
            expect(second.map((session) => session.taskId)).toEqual(["cc-legacy"]);
            await secondTab.clear();
            expect(await repository().list(now)).toEqual([]);
            expect((await repository(oneOrigin, oneFactory).list(now)).map((session) => session.taskId)).toEqual([
                "one-legacy"
            ]);
        } finally {
            await deleteDatabases(oneFactory);
        }
    });

    it("retries a failed GM read without discarding a newer session with the same task ID", async () => {
        const legacy = createSession("same-task");
        const newer = createSession("same-task");
        newer.book.title = "Updated";
        seedLegacy(legacy, createSession("legacy-only"));
        const gm = getUserscriptApiMocks();
        gm.getValue.mockImplementationOnce(() => {
            throw new Error("GM storage unavailable");
        });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const tab = repository();
        await tab.start(newer, now);
        const sessions = await tab.list(now);
        expect(sessions.map((session) => session.taskId).sort()).toEqual(["legacy-only", "same-task"]);
        expect(sessions.find((session) => session.taskId === "same-task")?.book.title).toBe("Updated");
    });

    it("rolls back legacy records and the migration marker when the transaction aborts", async () => {
        seedLegacy(createSession("one"), createSession("two"));
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (this: IDBObjectStore, value, key) {
            const request = put.call(this, value, key);
            request.addEventListener("success", () => this.transaction.abort(), { once: true });
            return request;
        });

        expect(await repository().list(now)).toEqual([]);
        expect((await repository().list(now)).map((session) => session.taskId)).toEqual(["one", "two"]);
    });

    it("merges updates from two connections and does not recreate deleted sessions", async () => {
        const firstTab = repository();
        const secondTab = repository();
        await Promise.all([firstTab.start(createSession("first"), now), secondTab.start(createSession("second"), now)]);
        const appendLog = (message: string) => (session: DiagnosticSession) => {
            session.logs.push({ at: 0, level: "info", message });
            return session;
        };
        await Promise.all([
            firstTab.update("first", appendLog("from first"), now),
            secondTab.update("first", appendLog("from second"), now),
            secondTab.update("second", appendLog("other task"), now)
        ]);

        const sessions = await secondTab.list(now);
        expect(
            sessions
                .find((session) => session.taskId === "first")
                ?.logs.map((log) => log.message)
                .sort()
        ).toEqual(["from first", "from second"]);
        expect(sessions.find((session) => session.taskId === "second")?.logs[0].message).toBe("other task");
        await secondTab.remove("session-first");
        await firstTab.update("first", appendLog("late"), now);
        expect((await firstTab.list(now)).map((session) => session.taskId)).toEqual(["second"]);

        await secondTab.clear();
        await firstTab.update("second", appendLog("also late"), now);
        expect(await secondTab.list(now)).toEqual([]);
    });

    it("evicts older records from the database while retaining the newest history and active task", async () => {
        const active = createSession("active");
        active.result = "running";
        active.endedAt = null;
        const history = Array.from({ length: 30 }, (_, index) => {
            const session = createSession(`history-${index}`);
            session.endedAt = session.updatedAt = now - 30 + index;
            session.logs = Array.from({ length: 100 }, () => ({ at: 0, level: "info", message: "x ".repeat(1_000) }));
            return session;
        });
        getUserscriptApiMocks().values.set(legacyKey, { schemaVersion: 1, active: [active], history });

        const sessions = await repository().list(now);
        const ids = sessions.map((session) => session.taskId);
        expect(ids).toContain("active");
        expect(ids).toContain("history-29");
        expect(ids).not.toContain("history-0");
        expect(Buffer.byteLength(JSON.stringify(sessions), "utf8")).toBeLessThan(4 * 1024 * 1024);
    });

    it("retains a newly finished session when completion times tie at the history limit", async () => {
        seedLegacy(...Array.from({ length: 30 }, (_, index) => createSession(`old-${index}`)));
        const tab = repository();
        const finished = createSession("just-finished");
        await tab.start({ ...finished, result: "running", endedAt: null }, now);
        await tab.update(finished.taskId, () => finished, now);

        const tasks = (await tab.list(now)).map(({ taskId }) => taskId);
        expect(tasks).toHaveLength(30);
        expect(tasks).toContain("just-finished");
        expect(tasks).not.toContain("old-29");
    });
});
