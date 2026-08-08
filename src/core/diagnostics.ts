import type {
    DownloadEvent,
    DownloadOptions,
    DownloadPhase,
    DownloadSnapshot,
    DownloadTask
} from "./download/contracts";
import type { DomainMessageParams } from "./messages";

// 诊断数据独立于章节缓存；容量和保留期同时限制，避免长期占用 userscript 存储
export const DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DIAGNOSTIC_HISTORY_LIMIT = 10;
export const DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_TOTAL_BYTES_LIMIT = 2 * 1024 * 1024;
export const DIAGNOSTIC_SESSION_BYTES_LIMIT = 256 * 1024;
const DIAGNOSTIC_LOG_LIMIT = 500;
const DIAGNOSTIC_EVENT_LIMIT = 500;
// 同一全本任务只保留最近导出结果
const DIAGNOSTIC_EXPORT_LIMIT = 50;
const DIAGNOSTIC_MESSAGE_LIMIT = 2_000;
const DIAGNOSTIC_ACTIVE_STALE_MS = 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_CLOSE_UNCONFIRMED_MS = 30 * 60 * 1000;

export type DiagnosticResult = "running" | "success" | "cancelled" | "failed" | "interrupted";

export interface DiagnosticApplicationInfo {
    version: string;
    browser: string;
    userscriptManager: string;
}

export interface DiagnosticBookInfo {
    bookId: string;
    title: string;
    url: string;
    sourcePageType: string;
}

export interface DiagnosticSettings {
    concurrency: number;
    imageEnabled: boolean;
    epubTagPageEnabled: boolean;
}

export interface DiagnosticChapterInfo {
    index: number;
    title: string;
    url: string;
}

export interface DiagnosticFailure {
    at: number;
    scope: "download" | "chapter" | "image" | "storage" | "export" | "page";
    stage: string;
    code: string;
    message: string;
    imageFailureCount?: number;
    chapter?: DiagnosticChapterInfo;
}

export interface DiagnosticEventRecord {
    at: number;
    type: string;
    phase?: DownloadPhase;
    details?: Record<string, string | number | boolean | null>;
}

export interface DiagnosticLogRecord {
    at: number;
    level: "info" | "warning" | "error";
    // 旧版字符串日志或导出时生成的当前语言文本
    message?: string;
    // 新版日志持久化稳定消息码，不固化界面语言
    code?: string;
    params?: DomainMessageParams;
}

export interface RecordDiagnosticLogInput {
    level: DiagnosticLogRecord["level"];
    message?: string;
    code?: string;
    params?: DomainMessageParams;
}

export interface DiagnosticExportRecord {
    at: number;
    scope: "full" | "single";
    format: "txt" | "html" | "epub";
    outcome: "success" | "failed" | "cancelled";
    generated: boolean;
    downloadTriggered: boolean;
    failureStage: "generate" | "download" | null;
}

export interface DiagnosticTaskSummary {
    phase: DownloadPhase;
    totalChapters: number;
    restoredChapters: number;
    fetchedChapters: number;
    processedChapters: number;
    persistedChapters: number;
    completedChapters: number;
    readyChapters: number;
    protectedDetectedChapters: number;
    protectedPendingChapters: number;
    protectedResolvedChapters: number;
    protectedSkippedChapters: number;
    failedChapters: number;
    retryPendingChapters: number;
    cacheWriteCount: number;
    cacheWriteFailureCount: number;
    mappingFontChapterCount: number;
    mappingFontBytes: number;
    cancellationOutcome: string | null;
    storageFailureCode: string | null;
}

export interface DiagnosticSession {
    schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
    id: string;
    taskId: string;
    startedAt: number;
    updatedAt: number;
    endedAt: number | null;
    result: DiagnosticResult;
    closeObservedAt?: number;
    application: DiagnosticApplicationInfo;
    book: DiagnosticBookInfo;
    settings: DiagnosticSettings;
    task: DiagnosticTaskSummary;
    failures: DiagnosticFailure[];
    exports: DiagnosticExportRecord[];
    events: DiagnosticEventRecord[];
    logs: DiagnosticLogRecord[];
}

export type DiagnosticSessionPresentation = DiagnosticResult | "closed-unconfirmed" | "superseded";

export interface DiagnosticSessionView {
    session: DiagnosticSession;
    presentation: DiagnosticSessionPresentation;
}

export interface DiagnosticSessionViewStore {
    active: DiagnosticSessionView[];
    unconfirmed: DiagnosticSessionView[];
    history: DiagnosticSessionView[];
}

export interface DiagnosticStore {
    schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
    active: DiagnosticSession[];
    history: DiagnosticSession[];
}

export interface DiagnosticRepository {
    load(): DiagnosticStore;
    save(store: DiagnosticStore): void;
}

export interface StartDiagnosticSessionInput {
    taskId: string;
    bookId: string;
    bookTitle?: string;
    pageUrl: string;
    sourcePageType: string;
    totalChapters?: number;
    application: DiagnosticApplicationInfo;
    settings: DiagnosticSettings;
}

export interface RecordDiagnosticFailureInput {
    scope: DiagnosticFailure["scope"];
    stage: string;
    code: string;
    message: string;
    imageFailureCount?: number;
    chapter?: DownloadTask;
}

export type RecordDiagnosticExportInput = Omit<DiagnosticExportRecord, "at">;

export function createEmptyDiagnosticStore(): DiagnosticStore {
    return { schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, active: [], history: [] };
}

function stringBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function limitText(value: unknown): string {
    const text = sanitizeDiagnosticMessage(String(value ?? ""));
    return text.length <= DIAGNOSTIC_MESSAGE_LIMIT ? text : `${text.slice(0, DIAGNOSTIC_MESSAGE_LIMIT)}…（已截断）`;
}

function getDomainMessageDetail(code: string, params: Readonly<Record<string, unknown>>): string {
    return typeof params.detail === "string" ? params.detail : code;
}

/**
 * 仅保留 HTTP 或 HTTPS 诊断网址的来源与路径，无效或非网络协议返回空字符串
 */
export function sanitizeDiagnosticUrl(value: string): string {
    try {
        const url = new URL(value, "https://www.esjzone.cc");
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "";
        }
        return `${url.origin}${url.pathname}`;
    } catch {
        return "";
    }
}

/**
 * 移除诊断文本中的查询参数、认证字段、data URI 和长编码内容
 */
export function sanitizeDiagnosticMessage(value: string): string {
    // 保留排障所需 URL 路径，但移除查询参数、认证字段和可能承载正文或二进制的长编码内容
    return value
        .replace(/data:[^\s"']+/gi, "[data URI 已移除]")
        .replace(/\b(cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[已移除]")
        .replace(/https?:\/\/[^\s<>"']+/gi, (url) => sanitizeDiagnosticUrl(url))
        .replace(/[A-Za-z0-9+/]{128,}={0,2}/g, "[长编码内容已移除]");
}

function resultCleanupPriority(session: DiagnosticSession): number {
    // 数字越高越应保留；容量不足时依次淘汰成功、取消、失败或异常中断记录
    if (session.failures.length > 0 || session.result === "failed" || session.result === "interrupted") {
        return 2;
    }
    return session.result === "cancelled" ? 1 : 0;
}

function trimSessionToLimit(session: DiagnosticSession): DiagnosticSession {
    const trimmed: DiagnosticSession = {
        ...session,
        failures: session.failures.map((failure) => ({ ...failure, message: limitText(failure.message) })),
        exports: (session.exports || []).slice(-DIAGNOSTIC_EXPORT_LIMIT),
        events: session.events.slice(-DIAGNOSTIC_EVENT_LIMIT),
        logs: session.logs.slice(-DIAGNOSTIC_LOG_LIMIT).map((entry) => ({
            ...entry,
            ...(entry.message === undefined ? {} : { message: limitText(entry.message) })
        }))
    };
    // 先牺牲普通日志和阶段事件，最后才裁剪失败定位，并始终保留至少一条失败原因
    while (stringBytes(trimmed) > DIAGNOSTIC_SESSION_BYTES_LIMIT && trimmed.logs.length > 0) {
        trimmed.logs.shift();
    }
    while (stringBytes(trimmed) > DIAGNOSTIC_SESSION_BYTES_LIMIT && trimmed.events.length > 0) {
        trimmed.events.shift();
    }
    while (stringBytes(trimmed) > DIAGNOSTIC_SESSION_BYTES_LIMIT && trimmed.failures.length > 1) {
        trimmed.failures.shift();
    }
    return trimmed;
}

function repairTerminalResult(session: DiagnosticSession): DiagnosticSession {
    // 兼容缺少 exports 字段的早期诊断记录
    const normalized = {
        ...session,
        task: { ...initialTaskSummary(session.task.totalChapters), ...session.task },
        exports: Array.isArray(session.exports) ? session.exports : [],
        logs: (Array.isArray(session.logs) ? session.logs : []).map(normalizeDiagnosticLogRecord)
    };
    // 早期诊断实现可能被页面 finally 将已成功的 export-ready 会话覆盖为 failed；无失败证据时安全修正
    if (
        normalized.result === "failed" &&
        normalized.task.phase === "export-ready" &&
        normalized.failures.length === 0
    ) {
        return { ...normalized, result: "success" };
    }
    return normalized;
}

function normalizeDiagnosticLogRecord(entry: DiagnosticLogRecord): DiagnosticLogRecord {
    const level = entry.level === "warning" || entry.level === "error" ? entry.level : "info";
    return {
        at: typeof entry.at === "number" ? entry.at : 0,
        level,
        ...(typeof entry.message === "string" ? { message: limitText(entry.message) } : {}),
        ...(typeof entry.code === "string" ? { code: limitText(entry.code) } : {}),
        ...(entry.params ? { params: sanitizeDiagnosticParams(entry.params) } : {})
    };
}

function sanitizeDiagnosticParams(params: DomainMessageParams): DomainMessageParams {
    return Object.fromEntries(
        Object.entries(params).map(([key, value]) => [
            key,
            typeof value === "string" ? limitText(sanitizeDiagnosticMessage(value)) : value
        ])
    );
}

function normalizeStore(store: DiagnosticStore, now: number): DiagnosticStore {
    const active: DiagnosticSession[] = [];
    const interrupted: DiagnosticSession[] = [];
    // 页面异常退出不会执行正常收尾；超过 24 小时未更新的进行中会话转为异常中断
    for (const session of store.active || []) {
        if (now - session.updatedAt > DIAGNOSTIC_ACTIVE_STALE_MS) {
            interrupted.push({ ...session, result: "interrupted", endedAt: session.updatedAt });
        } else {
            active.push(trimSessionToLimit(repairTerminalResult(session)));
        }
    }
    const history = [...interrupted, ...(store.history || [])]
        .filter((session) => now - (session.endedAt || session.updatedAt) <= DIAGNOSTIC_RETENTION_MS)
        .map(repairTerminalResult)
        .map(trimSessionToLimit);

    history.sort((a, b) => (b.endedAt || b.updatedAt) - (a.endedAt || a.updatedAt));
    // 当前任务不占历史条数；历史和全部进行中会话共同受总容量上限约束
    while (history.length > DIAGNOSTIC_HISTORY_LIMIT) {
        removeLowestPriorityOldest(history);
    }
    while (stringBytes({ schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, active, history }) > DIAGNOSTIC_TOTAL_BYTES_LIMIT) {
        if (history.length > 0) {
            removeLowestPriorityOldest(history);
        } else if (active.length > 0) {
            const oldest = active.reduce(
                (candidate, session, index, all) => (session.updatedAt < all[candidate].updatedAt ? index : candidate),
                0
            );
            active.splice(oldest, 1);
        } else {
            break;
        }
    }
    return { schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, active, history };
}

function isFullBookSession(session: DiagnosticSession): boolean {
    return session.book.sourcePageType === "detail" || session.book.sourcePageType === "forum";
}

function hasReplacementSession(session: DiagnosticSession, sessions: DiagnosticSession[]): boolean {
    const closeObservedAt = session.closeObservedAt;
    if (closeObservedAt === undefined || !isFullBookSession(session)) {
        return false;
    }
    return sessions.some(
        (candidate) =>
            candidate.taskId !== session.taskId &&
            candidate.book.bookId === session.book.bookId &&
            candidate.startedAt >= closeObservedAt &&
            candidate.task.phase !== "idle" &&
            isFullBookSession(candidate)
    );
}

/**
 * 构建只读展示模型不改变下载终态
 */
export function createDiagnosticSessionView(store: DiagnosticStore, now: number): DiagnosticSessionViewStore {
    const allSessions = [...store.active, ...store.history];
    const active: DiagnosticSessionView[] = [];
    const unconfirmed: DiagnosticSessionView[] = [];
    const history = store.history.map((session) => ({ session, presentation: session.result }));

    for (const session of store.active) {
        const closeObservedAt = session.closeObservedAt;
        if (closeObservedAt === undefined) {
            active.push({ session, presentation: "running" });
            continue;
        }
        if (now - closeObservedAt >= DIAGNOSTIC_CLOSE_UNCONFIRMED_MS) {
            history.push({ session, presentation: "interrupted" });
            continue;
        }
        unconfirmed.push({
            session,
            presentation: hasReplacementSession(session, allSessions) ? "superseded" : "closed-unconfirmed"
        });
    }

    history.sort(
        (left, right) =>
            (right.session.endedAt || right.session.updatedAt) - (left.session.endedAt || left.session.updatedAt)
    );
    return { active, unconfirmed, history };
}

function removeLowestPriorityOldest(history: DiagnosticSession[]): void {
    let candidate = 0;
    for (let index = 1; index < history.length; index++) {
        const currentPriority = resultCleanupPriority(history[index]);
        const candidatePriority = resultCleanupPriority(history[candidate]);
        if (
            currentPriority < candidatePriority ||
            (currentPriority === candidatePriority && history[index].updatedAt < history[candidate].updatedAt)
        ) {
            candidate = index;
        }
    }
    history.splice(candidate, 1);
}

function initialTaskSummary(totalChapters: number): DiagnosticTaskSummary {
    return {
        phase: "idle",
        totalChapters,
        restoredChapters: 0,
        fetchedChapters: 0,
        processedChapters: 0,
        persistedChapters: 0,
        completedChapters: 0,
        readyChapters: 0,
        protectedDetectedChapters: 0,
        protectedPendingChapters: 0,
        protectedResolvedChapters: 0,
        protectedSkippedChapters: 0,
        failedChapters: 0,
        retryPendingChapters: 0,
        cacheWriteCount: 0,
        cacheWriteFailureCount: 0,
        mappingFontChapterCount: 0,
        mappingFontBytes: 0,
        cancellationOutcome: null,
        storageFailureCode: null
    };
}

function applySnapshot(session: DiagnosticSession, snapshot: DownloadSnapshot): void {
    session.task = {
        ...session.task,
        phase: snapshot.phase,
        totalChapters: snapshot.scheduledCount,
        restoredChapters: snapshot.restoredCount,
        fetchedChapters: snapshot.fetchedCount,
        processedChapters: snapshot.processedCount,
        persistedChapters: snapshot.persistedCount,
        completedChapters: snapshot.completedCount,
        readyChapters: snapshot.readyChapterCount,
        protectedDetectedChapters: snapshot.protectedDetectedCount,
        protectedPendingChapters: snapshot.protectedPendingCount,
        protectedResolvedChapters: snapshot.protectedResolvedCount,
        protectedSkippedChapters: snapshot.protectedSkippedCount,
        failedChapters: snapshot.failedCount,
        retryPendingChapters: snapshot.retryPendingCount,
        cancellationOutcome: snapshot.cancellationOutcome,
        storageFailureCode: snapshot.storageFailure?.reason || null
    };
}

/**
 * 管理环境无关的诊断会话；浏览器存储、下载和剪贴板能力由外层适配
 */
export class DiagnosticManager {
    constructor(
        private readonly repository: DiagnosticRepository,
        private readonly now: () => number = () => Date.now()
    ) {}

    /**
     * 创建并持久化活动诊断会话，相同 taskId 的旧活动记录会被替换
     * 页面网址写入时只保留 HTTP 或 HTTPS 来源与路径
     */
    start(input: StartDiagnosticSessionInput): DiagnosticSession {
        const now = this.now();
        const store = normalizeStore(this.repository.load(), now);
        // 同一 taskId 重入时替换旧的进行中记录，避免重复会话持续占用容量
        store.active = store.active.filter((session) => session.taskId !== input.taskId);
        const session: DiagnosticSession = {
            schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
            id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
            taskId: input.taskId,
            startedAt: now,
            updatedAt: now,
            endedAt: null,
            result: "running",
            application: input.application,
            book: {
                bookId: input.bookId,
                title: input.bookTitle || "未知作品",
                url: sanitizeDiagnosticUrl(input.pageUrl),
                sourcePageType: input.sourcePageType
            },
            settings: input.settings,
            task: initialTaskSummary(input.totalChapters || 0),
            failures: [],
            exports: [],
            events: [{ at: 0, type: "session-started" }],
            logs: []
        };
        store.active.push(session);
        this.repository.save(normalizeStore(store, now));
        return session;
    }

    /**
     * 为 taskId 标识的活动会话记录页面关闭时间，会话不存在或已有 closeObservedAt 时不重复写入
     */
    markCloseObserved(taskId: string): void {
        const now = this.now();
        const store = normalizeStore(this.repository.load(), now);
        const session = store.active.find((item) => item.taskId === taskId);
        if (!session || session.closeObservedAt !== undefined) {
            return;
        }
        // 页面关闭只记录可观察事实
        session.closeObservedAt = now;
        session.updatedAt = now;
        this.repository.save(normalizeStore(store, now));
    }

    /**
     * 更新 taskId 标识的活动会话书籍和任务元数据，会话不存在时保持不变
     */
    updateSession(
        taskId: string,
        options: Partial<Pick<DownloadOptions, "bookName" | "pageUrl" | "sourcePageType" | "tasks">>
    ): void {
        this.mutateSession(taskId, (session) => {
            if (options.bookName) {
                session.book.title = options.bookName;
            }
            if (options.pageUrl) {
                session.book.url = sanitizeDiagnosticUrl(options.pageUrl);
            }
            if (options.sourcePageType) {
                session.book.sourcePageType = options.sourcePageType;
            }
            if (options.tasks) {
                session.task.totalChapters = options.tasks.length;
            }
        });
    }

    /**
     * 向 taskId 标识的活动会话追加脱敏日志，字符串输入按 info 级别记录
     */
    recordLog(taskId: string, input: string | RecordDiagnosticLogInput): void {
        this.mutateSession(taskId, (session, now) => {
            const record = typeof input === "string" ? { level: "info" as const, message: input } : input;
            session.logs.push(
                normalizeDiagnosticLogRecord({
                    at: now - session.startedAt,
                    level: record.level,
                    ...(record.message === undefined ? {} : { message: record.message }),
                    ...(record.code === undefined ? {} : { code: record.code }),
                    ...(record.params === undefined ? {} : { params: record.params })
                })
            );
            if (session.logs.length > DIAGNOSTIC_LOG_LIMIT) {
                session.logs.shift();
            }
        });
    }

    /**
     * 向 taskId 标识的活动或历史会话追加脱敏失败记录，会话不存在时保持不变
     */
    recordFailure(taskId: string, input: RecordDiagnosticFailureInput): void {
        this.mutateSession(
            taskId,
            (session, now) => {
                session.failures.push({
                    at: now - session.startedAt,
                    scope: input.scope,
                    stage: input.stage,
                    code: input.code,
                    message: limitText(input.message),
                    ...(input.imageFailureCount === undefined ? {} : { imageFailureCount: input.imageFailureCount }),
                    ...(input.chapter
                        ? {
                              chapter: {
                                  index: input.chapter.index + 1,
                                  title: input.chapter.title,
                                  url: sanitizeDiagnosticUrl(input.chapter.url)
                              }
                          }
                        : {})
                });
            },
            true
        );
    }

    /**
     * 向 taskId 标识的活动或历史会话追加导出结果，会话不存在时保持不变
     */
    recordExport(taskId: string, input: RecordDiagnosticExportInput): void {
        this.mutateSession(
            taskId,
            (session, now) => {
                session.exports.push({ at: now - session.startedAt, ...input });
                if (session.exports.length > DIAGNOSTIC_EXPORT_LIMIT) {
                    session.exports.shift();
                }
            },
            true
        );
    }

    /**
     * 将下载事件归并到诊断摘要，并在导出就绪、取消或失败时写入终态
     */
    recordDownloadEvent(taskId: string, event: DownloadEvent): void {
        if (event.type === "chapter-restored" || event.type === "chapter-processed") {
            // 逐章恢复和处理只汇总到快照
            return;
        }
        this.mutateSession(
            taskId,
            (session, now) => {
                const at = now - session.startedAt;
                // 高频 snapshot 只覆盖汇总，不逐条写入事件数组；阶段、失败和缓存结果才进入时间线
                if (
                    event.type === "snapshot-updated" ||
                    event.type === "phase-changed" ||
                    event.type === "download-failed"
                ) {
                    applySnapshot(session, event.snapshot);
                }
                if (event.type === "phase-changed") {
                    session.events.push({
                        at,
                        type: event.type,
                        phase: event.current,
                        details: { previous: event.previous }
                    });
                    if (event.current === "export-ready") {
                        this.finishInStore(session, "success", now);
                    }
                    if (event.current === "cancelled") {
                        this.finishInStore(session, "cancelled", now);
                    }
                    if (event.current === "failed") {
                        this.finishInStore(session, "failed", now);
                    }
                } else if (event.type === "cache-write-finished") {
                    session.task.cacheWriteCount++;
                    if (!event.saved) {
                        session.task.cacheWriteFailureCount++;
                    }
                    session.events.push({
                        at,
                        type: event.type,
                        details: {
                            chapterCount: event.chapterCount,
                            saved: event.saved,
                            code: event.failure?.reason || ""
                        }
                    });
                } else if (event.type === "chapter-failed") {
                    session.failures.push({
                        at,
                        scope: "chapter",
                        stage: event.stage,
                        code: event.code,
                        message: limitText(getDomainMessageDetail(event.code, event.params)),
                        chapter: {
                            index: event.task.index + 1,
                            title: event.task.title,
                            url: sanitizeDiagnosticUrl(event.task.url)
                        }
                    });
                } else if (event.type === "protected-chapter-password-rejected") {
                    session.events.push({
                        at,
                        type: event.type,
                        details: {
                            chapterIndex: event.task.index + 1,
                            chapterTitle: event.task.title,
                            result: "password-rejected"
                        }
                    });
                } else if (event.type === "mapping-font-updated") {
                    session.task.mappingFontChapterCount = event.summary.chapterCount;
                    session.task.mappingFontBytes = event.summary.fontBytes;
                } else if (event.type === "incomplete-chapters-decided") {
                    session.events.push({
                        at,
                        type: event.type,
                        details: { missingCount: event.missingCount, decision: event.decision }
                    });
                } else if (event.type === "download-failed") {
                    session.failures.push({
                        at,
                        scope: event.snapshot.storageFailure ? "storage" : "download",
                        stage: event.snapshot.phase,
                        code: event.snapshot.storageFailure?.reason || event.code || "download-failed",
                        message: limitText(getDomainMessageDetail(event.code, event.params))
                    });
                }
                if (session.events.length > DIAGNOSTIC_EVENT_LIMIT) {
                    session.events.shift();
                }
            },
            true
        );
    }

    /**
     * 完成 taskId 标识的活动会话并合并可选任务摘要，任务已转入历史时不覆盖终态
     */
    finish(taskId: string, result: Exclude<DiagnosticResult, "running">, task?: Partial<DiagnosticTaskSummary>): void {
        // 页面 finally 只负责收尾仍处于 active 的启动阶段会话，不得覆盖 coordinator 已发布的终态
        this.mutateSession(taskId, (session, now) => {
            if (task) {
                session.task = { ...session.task, ...task };
            }
            this.finishInStore(session, result, now);
        });
    }

    /**
     * 读取经过兼容修复、保留期限和容量约束处理的快照，不将结果回写 repository
     */
    list(): DiagnosticStore {
        // 诊断查询不回写旧快照
        return normalizeStore(this.repository.load(), this.now());
    }

    remove(sessionId: string): void {
        const now = this.now();
        const store = normalizeStore(this.repository.load(), now);
        store.active = store.active.filter((session) => session.id !== sessionId);
        store.history = store.history.filter((session) => session.id !== sessionId);
        this.repository.save(store);
    }

    clear(): void {
        this.repository.save(createEmptyDiagnosticStore());
    }

    private finishInStore(session: DiagnosticSession, result: Exclude<DiagnosticResult, "running">, now: number): void {
        session.result = result;
        session.endedAt = now;
        session.updatedAt = now;
    }

    private mutateSession(
        taskId: string,
        mutator: (session: DiagnosticSession, now: number) => void,
        includeHistory = false
    ): void {
        const now = this.now();
        const store = normalizeStore(this.repository.load(), now);
        let session = store.active.find((item) => item.taskId === taskId);
        const activeIndex = session ? store.active.indexOf(session) : -1;
        if (!session && includeHistory) {
            session = store.history.find((item) => item.taskId === taskId);
        }
        if (!session) {
            return;
        }
        mutator(session, now);
        session.updatedAt = now;
        // 终态变更与历史搬移在同一次 repository save 中完成，避免同时存在于 active 和 history
        if (activeIndex >= 0 && session.result !== "running") {
            store.active.splice(activeIndex, 1);
            store.history.unshift(session);
        }
        this.repository.save(normalizeStore(store, now));
    }
}
