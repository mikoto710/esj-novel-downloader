import { DIAGNOSTIC_RETENTION_MS, isDiagnosticSessionActive, type DiagnosticSession } from "../diagnostics/manager";

const CLOSE_KEY_PREFIX = "esj-diagnostic-page-close:";

type CloseCandidate = Pick<DiagnosticSession, "taskId" | "startedAt" | "updatedAt" | "result" | "closeObservedAt">;

/**
 * 同步保存页面关闭时间，离页中止诊断写入后仍可读取
 */
export function rememberDiagnosticPageClose(taskId: string): void {
    try {
        localStorage.setItem(CLOSE_KEY_PREFIX + taskId, String(Date.now()));
    } catch {
        // 本域存储不可用时仍尝试提交正常诊断更新
    }
}

/**
 * 为会话或其保留清单补充尚未落盘的关闭观察，不改写终态
 */
export function withDiagnosticPageClose<T extends CloseCandidate>(session: T, now: number): T {
    if (session.result !== "running" || session.closeObservedAt !== undefined) {
        return session;
    }
    try {
        const observedAt = Number(localStorage.getItem(CLOSE_KEY_PREFIX + session.taskId) ?? NaN);
        if (
            observedAt >= session.startedAt &&
            observedAt <= now &&
            now - observedAt <= DIAGNOSTIC_RETENTION_MS &&
            isDiagnosticSessionActive(session, observedAt)
        ) {
            return { ...session, closeObservedAt: observedAt, updatedAt: Math.max(session.updatedAt, observedAt) };
        }
    } catch {
        // 关闭观察不可用不影响会话读取
    }
    return session;
}

/**
 * 在会话更新或删除已提交后移除对应的临时关闭信号
 */
export function forgetDiagnosticPageCloses(taskIds: Iterable<string>): void {
    try {
        for (const taskId of taskIds) {
            localStorage.removeItem(CLOSE_KEY_PREFIX + taskId);
        }
    } catch {
        // 会话事务已经提交，临时信号无法清除时仍会按期限失效
    }
}

/**
 * 打开诊断数据库时清理超过保留期的临时关闭信号
 */
export function pruneDiagnosticPageCloses(): void {
    try {
        const cutoff = Date.now() - DIAGNOSTIC_RETENTION_MS;
        for (let index = localStorage.length - 1; index >= 0; index--) {
            const key = localStorage.key(index);
            if (key?.startsWith(CLOSE_KEY_PREFIX) && Number(localStorage.getItem(key)) < cutoff) {
                localStorage.removeItem(key);
            }
        }
    } catch {
        // 临时信号的清理独立于诊断数据库
    }
}
