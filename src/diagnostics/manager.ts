import type {
    DownloadEvent,
    DownloadLogCode,
    DownloadOptions,
    DownloadPhase,
    DownloadSnapshot,
    DownloadTask
} from "../download/contracts";
import type { DomainMessageParams } from "../messages";
import {
    createDownloadSelectionSummary,
    normalizeChapterSelectionSummary,
    type StoredDownloadSelectionSummary
} from "../download/plan";

// 诊断数据独立于章节缓存；容量和保留期同时限制，避免长期占用 userscript 存储
export const DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DIAGNOSTIC_HISTORY_LIMIT = 30;
export const DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_TOTAL_BYTES_LIMIT = 4 * 1024 * 1024;
export const DIAGNOSTIC_SESSION_BYTES_LIMIT = 256 * 1024;
// 区间详情最多占单会话预算的八分之一，其余空间留给事件、日志和失败记录
const DIAGNOSTIC_SELECTION_BYTES_LIMIT = DIAGNOSTIC_SESSION_BYTES_LIMIT / 8;
const DIAGNOSTIC_LOG_LIMIT = 500;
const DIAGNOSTIC_EVENT_LIMIT = 500;
// 每个诊断会话只保留容量上限内的近期导出记录
const DIAGNOSTIC_EXPORT_LIMIT = 50;
const DIAGNOSTIC_MESSAGE_LIMIT = 2_000;
const DIAGNOSTIC_ACTIVE_STALE_MS = 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_CLOSE_UNCONFIRMED_MS = 30 * 60 * 1000;

// 只在历史诊断中兼容旧阶段，当前下载不再驱动这些状态
type DiagnosticPhase = DownloadPhase | "completed" | "releasing-lock" | "released";

export type DiagnosticResult = "running" | "success" | "cancelled" | "failed" | "interrupted";

/**
 * 诊断会话保存的脚本与浏览器环境信息，未知浏览器版本用标记说明
 */
export interface DiagnosticApplicationInfo {
    version: string;
    browser: string;
    browserVersionUnknown?: true;
    userscriptManager: string;
}

/**
 * 诊断中用于定位来源作品的信息，URL 由记录入口脱敏
 */
export interface DiagnosticBookInfo {
    bookId: string;
    title: string;
    url: string;
    sourcePageType: string;
}

/**
 * 任务启动时固定的设置摘要，不跟随后续偏好变化
 */
export interface DiagnosticSettings {
    concurrency: number;
    imageEnabled: boolean;
    epubTagPageEnabled: boolean;
}

/**
 * 故障记录关联的章节身份，index 沿用原书绝对索引
 */
export interface DiagnosticChapterInfo {
    index: number;
    title: string;
    url: string;
}

/**
 * 诊断会话中的带时间故障记录，文字由记录入口脱敏并限制长度
 */
export interface DiagnosticFailure {
    at: number;
    scope: "download" | "chapter" | "image" | "storage" | "export" | "page";
    stage: string;
    code: string;
    message: string;
    imageFailureCount?: number;
    chapter?: DiagnosticChapterInfo;
}

/**
 * 诊断时间线中的业务事件，详情限于可序列化的标量字段
 */
export interface DiagnosticEventRecord {
    at: number;
    type: string;
    phase?: DiagnosticPhase;
    details?: Record<string, string | number | boolean | null>;
}

/**
 * 可兼容旧字符串消息的诊断日志，新记录使用稳定消息码与参数
 */
export interface DiagnosticLogRecord {
    at: number;
    level: "info" | "warning" | "error";
    // 旧版字符串日志或导出时生成的当前语言文本
    message?: string;
    // 新版日志持久化稳定消息码，不固化界面语言
    code?: string;
    params?: DomainMessageParams;
}

/**
 * 调用方提交的日志内容与级别，记录时间由诊断管理器补充
 */
export interface RecordDiagnosticLogInput {
    level: DiagnosticLogRecord["level"];
    message?: string;
    code?: string;
    params?: DomainMessageParams;
}

/**
 * 记录生成和下载触发事实，不表示浏览器已经保存文件
 */
export interface DiagnosticExportRecord {
    at: number;
    scope: "full" | "single";
    format: "txt" | "html" | "epub";
    outcome: "success" | "failed" | "cancelled";
    generated: boolean;
    downloadTriggered: boolean;
    failureStage: "generate" | "download" | null;
}

/**
 * 从下载事件汇总的诊断计数与阶段，不反向驱动下载任务
 */
export interface DiagnosticTaskSummary {
    phase: DiagnosticPhase;
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

/**
 * 过长的选择区间在诊断中只保留数量概览，不改变原任务的完整选择
 */
export type DiagnosticSelectionOverview =
    | { mode: "unknown" }
    | { mode: "all" | "selected"; sourceTotalChapters: number; selectedCount: number; rangeCount: number };

/**
 * 绑定来源 taskId 的诊断会话，集中保存启动快照、过程记录与终态
 */
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
    selection?: StoredDownloadSelectionSummary;
    selectionOverview?: DiagnosticSelectionOverview;
    settings: DiagnosticSettings;
    task: DiagnosticTaskSummary;
    failures: DiagnosticFailure[];
    exports: DiagnosticExportRecord[];
    events: DiagnosticEventRecord[];
    logs: DiagnosticLogRecord[];
}

export type DiagnosticSessionPresentation = DiagnosticResult | "closed-unconfirmed" | "superseded";

/**
 * 保留原诊断记录并附加展示状态，不代表持久终态已经变更
 */
export interface DiagnosticSessionView {
    session: DiagnosticSession;
    presentation: DiagnosticSessionPresentation;
}

/**
 * 按活动、页面关闭待确认和历史分类的诊断展示集合
 */
export interface DiagnosticSessionViewStore {
    active: DiagnosticSessionView[];
    unconfirmed: DiagnosticSessionView[];
    history: DiagnosticSessionView[];
}

/**
 * 分组后的诊断会话快照，沿用旧存储和导出使用的会话版本
 */
export interface DiagnosticStore {
    schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
    active: DiagnosticSession[];
    history: DiagnosticSession[];
}

/**
 * 按任务提交诊断变更，更新回调在目标会话存在时于事务内执行
 */
export interface DiagnosticRepository {
    start(session: DiagnosticSession, now: number): Promise<void>;
    update(
        taskId: string,
        change: (session: DiagnosticSession) => DiagnosticSession | undefined,
        now: number
    ): Promise<void>;
    list(now: number): Promise<DiagnosticSession[]>;
    remove(sessionId: string, now: number): Promise<void>;
    clear(): Promise<void>;
}

/**
 * 创建诊断会话的来源身份与启动快照，taskId 由调用方提供
 */
export interface StartDiagnosticSessionInput {
    taskId: string;
    bookId: string;
    bookTitle?: string;
    pageUrl: string;
    sourcePageType: string;
    totalChapters?: number;
    selection?: StoredDownloadSelectionSummary;
    application: DiagnosticApplicationInfo;
    settings: DiagnosticSettings;
}

/**
 * 管理器补充故障时间并脱敏，调用方不得传入正文或资源对象
 */
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

    // 先为选择详情限额，避免完整区间挤掉所有日志后仍无法满足会话上限
    if (trimmed.selection !== undefined) {
        delete trimmed.selectionOverview;
        if (stringBytes(trimmed.selection) > DIAGNOSTIC_SELECTION_BYTES_LIMIT) {
            const selection = normalizeChapterSelectionSummary(trimmed.selection);
            trimmed.selectionOverview = selection
                ? {
                      mode: selection.mode,
                      sourceTotalChapters: selection.sourceTotalChapters,
                      selectedCount: selection.selectedCount,
                      rangeCount: selection.ranges.length
                  }
                : { mode: "unknown" };
            delete trimmed.selection;
        }
    }

    // 超限时先裁剪日志和事件；已有失败记录时保留最后一条，不凭空补充失败
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

    // 兼容旧版收尾误写 failed 的记录：阶段已是 export-ready 且没有失败记录时修正为 success
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

/**
 * 按现有保留规则判断会话在指定时间是否仍处于活动期
 */
export function isDiagnosticSessionActive(
    session: Pick<DiagnosticSession, "result" | "updatedAt">,
    now: number
): boolean {
    return session.result === "running" && now - session.updatedAt <= DIAGNOSTIC_ACTIVE_STALE_MS;
}

/**
 * 兼容早期诊断字段并裁剪单条记录，过期活动会话沿用中断语义
 */
export function normalizeDiagnosticSession(session: DiagnosticSession, now: number): DiagnosticSession {
    const current = repairTerminalResult(session);
    if (current.result === "running" && !isDiagnosticSessionActive(current, now)) {
        current.result = "interrupted";
        current.endedAt = current.updatedAt;
    }
    return trimSessionToLimit(current);
}

export type DiagnosticRetentionEntry = Pick<DiagnosticSession, "result" | "endedAt" | "updatedAt"> & {
    bytes: number;
};

export function measureDiagnosticSession(session: DiagnosticSession): number {
    return stringBytes(session);
}

/**
 * 按会话大小、结果和时间选择应保留的活动及历史记录，无需读取其他会话内容
 */
export function retainDiagnosticEntries<T extends DiagnosticRetentionEntry>(
    entries: Iterable<T>,
    now: number
): { active: T[]; history: T[] } {
    const active: T[] = [];
    const completed: T[] = [];
    for (const entry of entries) {
        if (entry.bytes > DIAGNOSTIC_SESSION_BYTES_LIMIT) {
            continue;
        }
        if (isDiagnosticSessionActive(entry, now)) {
            active.push(entry);
        } else if (now - (entry.endedAt || entry.updatedAt) <= DIAGNOSTIC_RETENTION_MS) {
            completed.push(entry);
        }
    }
    const history = completed
        .sort((a, b) => (b.endedAt || b.updatedAt) - (a.endedAt || a.updatedAt))
        .slice(0, DIAGNOSTIC_HISTORY_LIMIT);

    // 优先淘汰历史，保留活动任务的诊断；逗号也计入导出集合的容量
    const arrayBytes = (entries: readonly T[]) =>
        entries.reduce((bytes, entry) => bytes + entry.bytes, Math.max(0, entries.length - 1));
    let bytes = stringBytes(createEmptyDiagnosticStore()) + arrayBytes(active) + arrayBytes(history);
    while (bytes > DIAGNOSTIC_TOTAL_BYTES_LIMIT) {
        if (history.length > 0) {
            bytes -= history.pop()!.bytes + Number(history.length > 0);
        } else {
            const oldest = active.reduce(
                (candidate, session, index, all) => (session.updatedAt < all[candidate].updatedAt ? index : candidate),
                0
            );
            bytes -= active.splice(oldest, 1)[0].bytes + Number(active.length > 0);
        }
    }
    return { active, history };
}

function createDiagnosticStore(sessions: DiagnosticSession[], now: number): DiagnosticStore {
    const entries = sessions.map((record) => {
        const session = normalizeDiagnosticSession(record, now);
        return {
            session,
            result: session.result,
            endedAt: session.endedAt,
            updatedAt: session.updatedAt,
            bytes: measureDiagnosticSession(session)
        };
    });
    const { active, history } = retainDiagnosticEntries(entries, now);
    return {
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
        active: active.map(({ session }) => session),
        history: history.map(({ session }) => session)
    };
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

interface DiagnosticMutation {
    now: number;
    apply(session: DiagnosticSession): boolean;
}

interface DiagnosticMutationBatch {
    taskId: string;
    changes: DiagnosticMutation[];
    committed: Promise<void>;
}

/**
 * 管理环境无关的诊断会话；浏览器存储、下载和剪贴板能力由外层适配
 */
export class DiagnosticManager {
    private operations = Promise.resolve();
    private pendingBatch: DiagnosticMutationBatch | undefined;

    constructor(
        private readonly repository: DiagnosticRepository,
        private readonly now: () => number = () => Date.now()
    ) {}

    /**
     * 创建脱敏的活动诊断会话，重复的任务启动不会覆盖已有记录
     */
    start(input: StartDiagnosticSessionInput): Promise<void> {
        const now = this.now();
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
                title: input.bookTitle || "",
                url: sanitizeDiagnosticUrl(input.pageUrl),
                sourcePageType: input.sourcePageType
            },
            ...(input.selection === undefined ? {} : { selection: input.selection }),
            settings: input.settings,
            task: initialTaskSummary(input.totalChapters || 0),
            failures: [],
            exports: [],
            events: [{ at: 0, type: "session-started" }],
            logs: []
        };
        return this.enqueue(() => this.repository.start(trimSessionToLimit(session), now));
    }

    /**
     * 为 taskId 标识的活动会话记录页面关闭时间，会话不存在或已有 closeObservedAt 时不重复写入
     */
    markCloseObserved(taskId: string): Promise<void> {
        return this.mutateSession(taskId, (session, now) => {
            if (session.closeObservedAt !== undefined) {
                return false;
            }
            session.closeObservedAt = now;
        });
    }

    /**
     * 更新 taskId 标识的活动会话书籍和任务元数据，会话不存在时保持不变
     */
    updateSession(
        taskId: string,
        options: Partial<Pick<DownloadOptions, "bookName" | "pageUrl" | "sourcePageType" | "tasks" | "selection">>
    ): Promise<void> {
        return this.mutateSession(taskId, (session) => {
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
            if (options.selection) {
                session.selection = createDownloadSelectionSummary(options.selection);
            }
        });
    }

    /**
     * 向 taskId 标识的活动会话追加脱敏日志，字符串输入按 info 级别记录
     */
    recordLog(taskId: string, input: string | RecordDiagnosticLogInput): Promise<void> {
        return this.mutateSession(taskId, (session, now) => {
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
    recordFailure(taskId: string | null, input: RecordDiagnosticFailureInput): Promise<void> {
        return this.mutateSession(
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
    recordExport(taskId: string | null, input: RecordDiagnosticExportInput): Promise<void> {
        return this.mutateSession(
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
    recordDownloadEvent(taskId: string, event: DownloadEvent): Promise<void> {
        if (event.type === "chapter-restored" || event.type === "chapter-processed") {
            // 逐章恢复和处理只汇总到快照
            return Promise.resolve();
        }
        // 失败终态后允许追加对应的失败详情，其他迟到事件不能改写终态或摘要
        const applyDownloadEvent = (session: DiagnosticSession, now: number) => {
            if (session.result !== "running" && session.result !== "failed") {
                return false;
            }
            const at = now - session.startedAt;
            // 高频 snapshot 只覆盖汇总，不逐条写入事件数组；阶段、失败和缓存结果才进入时间线
            if (
                session.result === "running" &&
                (event.type === "snapshot-updated" ||
                    event.type === "phase-changed" ||
                    event.type === "download-failed")
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
        };
        return this.mutateSession(taskId, applyDownloadEvent, event.type === "download-failed");
    }

    /**
     * 完成 taskId 标识的活动会话并合并可选任务摘要，任务已转入历史时不覆盖终态
     */
    finish(
        taskId: string,
        result: Exclude<DiagnosticResult, "running">,
        task?: Partial<DiagnosticTaskSummary>
    ): Promise<void> {
        // 应用 finally 只结束仍活跃的启动会话，不覆盖下载事件已发布的终态
        return this.mutateSession(taskId, (session, now) => {
            if (task) {
                session.task = { ...session.task, ...task };
            }
            this.finishInStore(session, result, now);
        });
    }

    /**
     * 读取经过兼容修复、保留期限和容量约束处理的快照，不将结果回写 repository
     */
    list(): Promise<DiagnosticStore> {
        return this.enqueue(() => this.readStore(this.now()));
    }

    remove(sessionId: string): Promise<void> {
        return this.enqueue(() => this.repository.remove(sessionId, this.now()));
    }

    clear(): Promise<void> {
        return this.enqueue(() => this.repository.clear());
    }

    private finishInStore(session: DiagnosticSession, result: Exclude<DiagnosticResult, "running">, now: number): void {
        session.result = result;
        session.endedAt = now;
        session.updatedAt = now;
    }

    private mutateSession(
        taskId: string | null,
        mutator: (session: DiagnosticSession, now: number) => false | void,
        includeHistory = false
    ): Promise<void> {
        const now = this.now();
        const change: DiagnosticMutation = {
            now,
            apply(session) {
                if ((!includeHistory && session.result !== "running") || mutator(session, now) === false) {
                    return false;
                }
                session.updatedAt = Math.max(session.updatedAt, now);
                return true;
            }
        };
        if (!taskId) {
            return this.enqueue(async () => {
                const { active, history } = await this.readStore(now);
                const latest = active.sort((a, b) => b.updatedAt - a.updatedAt)[0] || history[0];
                if (latest) {
                    await this.commitChanges(latest.taskId, [change]);
                }
            });
        }

        // 合并连续的同任务变更，读取、创建和清理都结束当前批次
        if (this.pendingBatch?.taskId === taskId && this.pendingBatch.changes.length < 64) {
            this.pendingBatch.changes.push(change);
            return this.pendingBatch.committed;
        }
        const changes = [change];
        const committed = this.enqueue(() => {
            if (this.pendingBatch?.changes === changes) {
                this.pendingBatch = undefined;
            }
            return this.commitChanges(taskId, changes);
        });
        this.pendingBatch = { taskId, changes, committed };
        return committed;
    }

    private commitChanges(taskId: string, changes: DiagnosticMutation[]): Promise<void> {
        return this.repository.update(
            taskId,
            (session) => {
                const current = normalizeDiagnosticSession(session, changes[0].now);
                let changed = false;
                for (const change of changes) {
                    changed = change.apply(current) || changed;
                }
                return changed ? trimSessionToLimit(current) : undefined;
            },
            changes.at(-1)!.now
        );
    }

    private async readStore(now: number): Promise<DiagnosticStore> {
        return createDiagnosticStore(await this.repository.list(now), now);
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        this.pendingBatch = undefined;
        const result = this.operations.then(operation);
        // 单次持久化失败不阻塞队列中的后续诊断操作
        this.operations = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }
}

const ERROR_LOG_CODES = new Set<DownloadLogCode>([
    "cover-cache-write-ownership-lost",
    "chapter-mapping-font-failed",
    "protected-chapter-connection-failed",
    "protected-chapter-protocol-failed",
    "download-storage-failed",
    "cache-discard-failed"
]);

const WARNING_LOG_CODES = new Set<DownloadLogCode>([
    "cover-cache-read-failed",
    "cover-cache-write-failed",
    "restored-mapping-font-invalid",
    "cache-write-retry",
    "chapter-fetch-failed",
    "chapter-skipped-non-site",
    "protected-chapter-retry-skipped",
    "protected-chapter-redetected",
    "protected-chapter-queued",
    "protected-chapter-skipped",
    "protected-chapter-connection-retry",
    "protected-chapter-password-rejected",
    "integrity-check-failed",
    "chapter-integrity-retry",
    "missing-chapter-retry",
    "missing-chapter-export-with-placeholders",
    "missing-chapter-retry-started",
    "cancellation-cache-write-skipped-lock-lost"
]);

export function classifyDownloadLogLevel(code: DownloadLogCode): DiagnosticLogRecord["level"] {
    if (ERROR_LOG_CODES.has(code)) {
        return "error";
    }
    return WARNING_LOG_CODES.has(code) ? "warning" : "info";
}
