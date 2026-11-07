import { DIAGNOSTIC_SCHEMA_VERSION, normalizeDiagnosticSession, type DiagnosticSession } from "../diagnostics/manager";

const LEGACY_DIAGNOSTIC_KEY = "esj_diagnostic_sessions_v1";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): boolean {
    return Array.isArray(value) && value.every(isRecord);
}

function isLegacySession(value: unknown): value is DiagnosticSession {
    if (!isRecord(value) || !isRecord(value.book)) {
        return false;
    }
    return (
        value.schemaVersion === DIAGNOSTIC_SCHEMA_VERSION &&
        typeof value.id === "string" &&
        value.id.length > 0 &&
        typeof value.taskId === "string" &&
        value.taskId.length > 0 &&
        Number.isFinite(value.startedAt) &&
        Number.isFinite(value.updatedAt) &&
        (value.endedAt === null || Number.isFinite(value.endedAt)) &&
        ["running", "success", "cancelled", "failed", "interrupted"].some((result) => result === value.result) &&
        typeof value.book.url === "string" &&
        isRecord(value.application) &&
        isRecord(value.settings) &&
        isRecord(value.task) &&
        isRecordArray(value.failures) &&
        isRecordArray(value.events) &&
        (value.logs === undefined || isRecordArray(value.logs)) &&
        (value.exports === undefined || isRecordArray(value.exports))
    );
}

function isFromOrigin(url: string, origin: string): boolean {
    try {
        const parsed = new URL(url);
        return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === origin;
    } catch {
        return false;
    }
}

/**
 * 从旧 GM 集合提取能按绝对页面地址归到当前站点的会话
 */
export function readLegacyDiagnosticSessions(origin: string, now: number): DiagnosticSession[] {
    const stored = GM_getValue<unknown>(LEGACY_DIAGNOSTIC_KEY, null);
    if (
        !isRecord(stored) ||
        stored.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION ||
        !Array.isArray(stored.active) ||
        !Array.isArray(stored.history)
    ) {
        return [];
    }

    const sessions = new Map<string, DiagnosticSession>();
    for (const value of [...stored.active, ...stored.history]) {
        if (!isLegacySession(value) || !isFromOrigin(value.book.url, origin)) {
            continue;
        }
        const previous = sessions.get(value.taskId);
        // 旧数据可能同时保存活动和历史版本，优先保留终态，再比较更新时间
        if (
            !previous ||
            (previous.result === "running" && value.result !== "running") ||
            ((previous.result === "running") === (value.result === "running") && value.updatedAt >= previous.updatedAt)
        ) {
            sessions.set(value.taskId, value);
        }
    }
    return [...sessions.values()].map((session) => normalizeDiagnosticSession(session, now));
}
