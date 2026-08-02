/**
 * 持久缓存失败的稳定原因码
 */
export type StorageFailureReason =
    | "quota-exceeded"
    | "ownership-lost"
    | "transaction-aborted"
    | "database-unavailable"
    | "migration-failed"
    | "flush-timeout"
    | "unknown-storage-error";

/**
 * 发生存储失败时正在执行的操作
 */
export type StorageOperation = "read" | "claim" | "migrate" | "write" | "clear" | "flush";

/**
 * 可安全传递给 Coordinator、事件和 UI 的存储失败摘要
 */
export interface StorageFailure {
    reason: StorageFailureReason;
    operation: StorageOperation;
    message: string;
    causeReason?: Exclude<StorageFailureReason, "migration-failed">;
}

const STORAGE_FAILURE_MESSAGES: Readonly<Record<StorageFailureReason, string>> = Object.freeze({
    "quota-exceeded": "浏览器存储空间不足",
    "ownership-lost": "当前任务已失去缓存写入权",
    "transaction-aborted": "IndexedDB 事务意外中止",
    "database-unavailable": "IndexedDB 当前不可用",
    "migration-failed": "旧版缓存迁移失败",
    "flush-timeout": "缓存写入超时",
    "unknown-storage-error": "缓存存储发生未知错误"
});

function getErrorName(error: unknown): string {
    return error && typeof error === "object" && "name" in error ? String(error.name) : "";
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function classifyBaseReason(error: unknown): Exclude<StorageFailureReason, "migration-failed"> {
    const name = getErrorName(error);
    const message = getErrorMessage(error);
    if (name === "QuotaExceededError" || /quota|storage space/i.test(message)) {
        return "quota-exceeded";
    }
    if (name === "AbortError") {
        return "transaction-aborted";
    }
    if (
        ["InvalidStateError", "NotSupportedError", "SecurityError", "UnknownError"].includes(name) ||
        /indexeddb.*(?:unavailable|disabled|denied|not defined)/i.test(message)
    ) {
        return "database-unavailable";
    }
    return "unknown-storage-error";
}

/**
 * 带稳定原因码的存储异常；cause 仅用于控制台诊断，不进入用户诊断摘要
 */
export class StorageError extends Error {
    readonly reason: StorageFailureReason;
    readonly operation: StorageOperation;
    readonly causeReason?: Exclude<StorageFailureReason, "migration-failed">;

    constructor(failure: StorageFailure, options?: { cause?: unknown }) {
        super(failure.message, options);
        this.name = "StorageError";
        this.reason = failure.reason;
        this.operation = failure.operation;
        this.causeReason = failure.causeReason;
    }
}

/**
 * 将浏览器差异化的 IndexedDB 异常归一为稳定原因码
 */
export function normalizeStorageError(
    error: unknown,
    operation: StorageOperation,
    options: { migration?: boolean } = {}
): StorageError {
    if (error instanceof StorageError && !options.migration) {
        return error;
    }

    const causeReason =
        error instanceof StorageError
            ? error.reason === "migration-failed"
                ? error.causeReason || "unknown-storage-error"
                : error.reason
            : classifyBaseReason(error);
    const reason = options.migration ? "migration-failed" : causeReason;
    const detail = getErrorMessage(error);
    const message = `${STORAGE_FAILURE_MESSAGES[reason]}${detail ? `：${detail}` : ""}`;
    return new StorageError(
        {
            reason,
            operation,
            message,
            causeReason: options.migration
                ? (causeReason as Exclude<StorageFailureReason, "migration-failed">)
                : undefined
        },
        { cause: error }
    );
}

/**
 * 创建不依赖浏览器原始异常的业务存储错误
 */
export function createStorageError(reason: StorageFailureReason, operation: StorageOperation): StorageError {
    return new StorageError({ reason, operation, message: STORAGE_FAILURE_MESSAGES[reason] });
}

/**
 * 提取不包含正文或底层对象的失败摘要
 */
export function toStorageFailure(error: StorageError): StorageFailure {
    return {
        reason: error.reason,
        operation: error.operation,
        message: error.message,
        causeReason: error.causeReason
    };
}

/**
 * 用户取消主动中止的事务不属于存储故障
 */
export function isExpectedStorageCancellation(error: unknown, signal?: AbortSignal): boolean {
    return Boolean(signal?.aborted && getErrorName(error) === "AbortError");
}
