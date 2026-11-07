import { promisifyRequest } from "idb-keyval";
import {
    measureDiagnosticSession,
    retainDiagnosticEntries,
    type DiagnosticRepository,
    type DiagnosticRetentionEntry,
    type DiagnosticSession
} from "../diagnostics/manager";
import { readLegacyDiagnosticSessions } from "./diagnostic-migration";
import {
    forgetDiagnosticPageCloses,
    pruneDiagnosticPageCloses,
    withDiagnosticPageClose
} from "./diagnostic-page-close";

const DATABASE_NAME = "esj-novel-downloader-diagnostics";
const STORE_NAME = "sessions";
// 数字键保留给清单，字符串键对应各任务的会话
const MANIFEST_KEY = 0;

type SessionEntry = DiagnosticRetentionEntry &
    Pick<DiagnosticSession, "id" | "taskId" | "startedAt" | "closeObservedAt">;

interface DiagnosticManifest {
    migrationComplete: boolean;
    sessions: SessionEntry[];
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    const request = factory.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    return promisifyRequest(request);
}

function readManifest(database: IDBDatabase): Promise<DiagnosticManifest | undefined> {
    const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    return promisifyRequest(store.get(MANIFEST_KEY));
}

function writeDiagnostics(
    database: IDBDatabase,
    change: (store: IDBObjectStore, manifest: DiagnosticManifest, session?: DiagnosticSession) => void,
    taskId?: string
): Promise<void> {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        let operationError: unknown;
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
            reject(operationError ?? transaction.error ?? new DOMException("诊断事务已中止", "AbortError"));

        // 事务先读取目标会话，再读取清单；变更和裁剪在同一次提交中完成
        const sessionRequest: IDBRequest<DiagnosticSession | undefined> | undefined =
            taskId === undefined ? undefined : store.get(taskId);
        const manifestRequest: IDBRequest<DiagnosticManifest | undefined> = store.get(MANIFEST_KEY);
        manifestRequest.onsuccess = () => {
            try {
                change(
                    store,
                    manifestRequest.result ?? { migrationComplete: false, sessions: [] },
                    sessionRequest?.result
                );
            } catch (error) {
                operationError = error;
                transaction.abort();
            }
        };
    });
}

function saveSessions(
    store: IDBObjectStore,
    manifest: DiagnosticManifest,
    changed: readonly DiagnosticSession[],
    now: number
): void {
    const entries = new Map(manifest.sessions.map((entry) => [entry.taskId, entry]));
    const finished: SessionEntry[] = [];
    for (const session of changed) {
        const entry = {
            id: session.id,
            taskId: session.taskId,
            startedAt: session.startedAt,
            updatedAt: session.updatedAt,
            endedAt: session.endedAt,
            result: session.result,
            bytes: measureDiagnosticSession(session),
            ...(session.closeObservedAt === undefined ? {} : { closeObservedAt: session.closeObservedAt })
        };
        if (entries.get(session.taskId)?.result === "running" && session.result !== "running") {
            entries.delete(session.taskId);
            finished.push(entry);
        } else {
            entries.set(session.taskId, entry);
        }
    }
    // 同毫秒结束时，刚进入历史的会话排在此前的历史记录之前
    const ordered = [...finished, ...entries.values()];
    const { active, history } = retainDiagnosticEntries(
        ordered.map((entry) => withDiagnosticPageClose(entry, now)),
        now
    );
    const retained = new Set([...active, ...history].map(({ taskId }) => taskId));
    for (const entry of manifest.sessions) {
        if (!retained.has(entry.taskId)) {
            store.delete(entry.taskId);
        }
    }
    for (const session of changed) {
        if (retained.has(session.taskId)) {
            store.put(session, session.taskId);
        }
    }
    // 清单只保留预算和定位字段，并沿用活动记录的原始顺序
    manifest.sessions = ordered.filter(({ taskId }) => retained.has(taskId));
    store.put(manifest, MANIFEST_KEY);
}

/**
 * 在当前站点的独立数据库中按任务保存诊断会话
 */
export class IndexedDbDiagnosticRepository implements DiagnosticRepository {
    private connection: { factory: IDBFactory; opening: Promise<IDBDatabase> } | undefined;
    private migratedDatabase: IDBDatabase | undefined;

    constructor(
        private readonly getOrigin: () => string,
        private readonly getFactory: () => IDBFactory = () => indexedDB
    ) {}

    /**
     * 创建新任务的会话，已存在的同任务记录保持原状
     */
    async start(session: DiagnosticSession, now: number): Promise<void> {
        const database = await this.prepareDatabase(now);
        await writeDiagnostics(database, (store, manifest) => {
            if (!manifest.sessions.some(({ taskId }) => taskId === session.taskId)) {
                saveSessions(store, manifest, [session], now);
            }
        });
    }

    /**
     * 在同一事务内读改写指定任务，已删除的会话不会被晚到的更新重建
     */
    async update(
        taskId: string,
        change: (session: DiagnosticSession) => DiagnosticSession | undefined,
        now: number
    ): Promise<void> {
        const database = await this.prepareDatabase(now);
        await writeDiagnostics(
            database,
            (store, manifest, session) => {
                const updated = session && change(session);
                if (updated) {
                    saveSessions(store, manifest, [updated], now);
                }
            },
            taskId
        );
    }

    /**
     * 读取同一快照中的会话，迁移完成后只使用只读事务
     */
    async list(now: number): Promise<DiagnosticSession[]> {
        const database = await this.prepareDatabase(now);
        const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
        const [manifest, sessions] = await Promise.all([
            promisifyRequest<DiagnosticManifest | undefined>(store.get(MANIFEST_KEY)),
            promisifyRequest<DiagnosticSession[]>(store.getAll(IDBKeyRange.lowerBound("")))
        ]);
        const byTaskId = new Map(sessions.map((session) => [session.taskId, withDiagnosticPageClose(session, now)]));
        return (manifest?.sessions ?? []).flatMap(({ taskId }) => byTaskId.get(taskId) ?? []);
    }

    /**
     * 按会话 id 删除记录，事务提交后移除对应的关闭观察
     */
    async remove(sessionId: string, now = Date.now()): Promise<void> {
        const database = await this.prepareDatabase(now);
        let removedTaskId: string | undefined;
        await writeDiagnostics(database, (store, manifest) => {
            const index = manifest.sessions.findIndex(({ id }) => id === sessionId);
            if (index >= 0) {
                const [entry] = manifest.sessions.splice(index, 1);
                store.delete(entry.taskId);
                store.put(manifest, MANIFEST_KEY);
                removedTaskId = entry.taskId;
            }
        });
        if (removedTaskId !== undefined) {
            forgetDiagnosticPageCloses([removedTaskId]);
        }
    }

    /**
     * 清空本域并保留迁移标记，禁止从旧 GM 快照恢复已清除的记录
     */
    async clear(): Promise<void> {
        const database = await this.getDatabase();
        let removedTaskIds: string[] = [];
        await writeDiagnostics(database, (store, manifest) => {
            removedTaskIds = manifest.sessions.map(({ taskId }) => taskId);
            store.clear();
            store.put({ migrationComplete: true, sessions: [] } satisfies DiagnosticManifest, MANIFEST_KEY);
        });
        this.migratedDatabase = database;
        forgetDiagnosticPageCloses(removedTaskIds);
    }

    private async getDatabase(): Promise<IDBDatabase> {
        const factory = this.getFactory();
        if (this.connection?.factory === factory) {
            return this.connection.opening;
        }
        const opening = openDatabase(factory);
        const connection = { factory, opening };
        this.connection = connection;
        const invalidate = () => {
            if (this.connection === connection) {
                this.connection = undefined;
                this.migratedDatabase = undefined;
            }
        };
        try {
            const database = await opening;
            database.onversionchange = () => {
                database.close();
                invalidate();
            };
            database.onclose = invalidate;
            pruneDiagnosticPageCloses();
            return database;
        } catch (error) {
            invalidate();
            throw error;
        }
    }

    private async prepareDatabase(now: number): Promise<IDBDatabase> {
        const database = await this.getDatabase();
        if (this.migratedDatabase !== database) {
            await this.migrateLegacySessions(database, now);
        }
        return database;
    }

    private async migrateLegacySessions(database: IDBDatabase, now: number): Promise<void> {
        try {
            if (!(await readManifest(database))?.migrationComplete) {
                const legacySessions = readLegacyDiagnosticSessions(this.getOrigin(), now);
                await writeDiagnostics(database, (store, manifest) => {
                    // 两个标签页可能同时读到旧数据，提交前在事务内再次核对迁移标记
                    if (!manifest.migrationComplete) {
                        const existing = new Set(manifest.sessions.map(({ taskId }) => taskId));
                        const imported = legacySessions.filter(({ taskId }) => !existing.has(taskId));
                        manifest.migrationComplete = true;
                        saveSessions(store, manifest, imported, now);
                    }
                });
            }
            this.migratedDatabase = database;
        } catch (error) {
            // 旧存储失败时仍允许使用新数据库，下一次操作继续尝试迁移
            console.warn("迁移旧诊断记录失败", error);
        }
    }
}
